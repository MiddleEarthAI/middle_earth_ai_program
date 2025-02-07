use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack; // For unpack_from_slice
use anchor_spl::token::{transfer, Transfer, Token};
use spl_token::state::Account as SplTokenAccount; // Import SPL Token Account
use crate::state::{Agent, Game};
use crate::error::GameError;
use crate::events::*; 

const AGENT_VS_ALLIANCE_COOLDOWN: i64 = 3500;
const ALLIANCE_VS_ALLIANCE_COOLDOWN: i64 = 3600;
const SIMPLE_BATTLE_COOLDOWN: i64 = 3600;

/// Starts a battle between an agent and an alliance.
pub fn start_battle_agent_vs_alliance(
    ctx: Context<StartBattleAgentVsAlliance>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let attacker = &mut ctx.accounts.attacker;
    let alliance_leader = &mut ctx.accounts.alliance_leader;
    let alliance_partner = &mut ctx.accounts.alliance_partner;

    // Ensure all agents are alive
    require!(attacker.is_alive, GameError::AgentNotAlive);
    require!(alliance_leader.is_alive, GameError::AgentNotAlive);
    require!(alliance_partner.is_alive, GameError::AgentNotAlive);

    // Ensure none are already in a battle
    require!(attacker.battle_start_time.is_none(), GameError::BattleAlreadyStarted);
    require!(alliance_leader.battle_start_time.is_none(), GameError::BattleAlreadyStarted);
    require!(alliance_partner.battle_start_time.is_none(), GameError::BattleAlreadyStarted);

    // Record battle start time
    attacker.battle_start_time = Some(now);
    alliance_leader.battle_start_time = Some(now);
    alliance_partner.battle_start_time = Some(now);


    Ok(())
}

/// Starts a battle between two alliances.
pub fn start_battle_alliance_vs_alliance(
    ctx: Context<StartBattleAlliances>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let leader_a = &mut ctx.accounts.leader_a;
    let partner_a = &mut ctx.accounts.partner_a;
    let leader_b = &mut ctx.accounts.leader_b;
    let partner_b = &mut ctx.accounts.partner_b;

    // Ensure all agents are alive
    require!(leader_a.is_alive, GameError::AgentNotAlive);
    require!(partner_a.is_alive, GameError::AgentNotAlive);
    require!(leader_b.is_alive, GameError::AgentNotAlive);
    require!(partner_b.is_alive, GameError::AgentNotAlive);

    // Ensure none are already in a battle
    require!(leader_a.battle_start_time.is_none(), GameError::BattleAlreadyStarted);
    require!(partner_a.battle_start_time.is_none(), GameError::BattleAlreadyStarted);
    require!(leader_b.battle_start_time.is_none(), GameError::BattleAlreadyStarted);
    require!(partner_b.battle_start_time.is_none(), GameError::BattleAlreadyStarted);

    // Record battle start time
    leader_a.battle_start_time = Some(now);
    partner_a.battle_start_time = Some(now);
    leader_b.battle_start_time = Some(now);
    partner_b.battle_start_time = Some(now);

    // Optionally emit an event
    // emit!(BattleStarted { ... });

    Ok(())
}

/// Starts a simple battle between two agents.
pub fn start_battle_simple(
    ctx: Context<StartBattleSimple>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let winner = &mut ctx.accounts.winner;
    let loser = &mut ctx.accounts.loser;

    // Ensure both agents are alive
    require!(winner.is_alive, GameError::AgentNotAlive);
    require!(loser.is_alive, GameError::AgentNotAlive);

    // Ensure neither agent is already in a battle
    require!(winner.battle_start_time.is_none(), GameError::BattleAlreadyStarted);
    require!(loser.battle_start_time.is_none(), GameError::BattleAlreadyStarted);

    // Record battle start time
    winner.battle_start_time = Some(now);
    loser.battle_start_time = Some(now);

    // Optionally emit an event
    // emit!(BattleStarted { ... });

    Ok(())
}

/// Resolves a battle between an agent and an alliance after cooldown.
pub fn resolve_battle_agent_vs_alliance(
    ctx: Context<ResolveBattleAgentAlliance>,
    percent_lost: u8,
    agent_is_winner: bool,
) -> Result<()> {
    let authority = &ctx.accounts.authority;
    let game = &ctx.accounts.game;
    require!(authority.key() == game.authority, GameError::Unauthorized);

    let now = Clock::get()?.unix_timestamp;

    let single_agent = &mut ctx.accounts.single_agent;
    let alliance_leader = &mut ctx.accounts.alliance_leader;
    let alliance_partner = &mut ctx.accounts.alliance_partner;

    // Ensure battle has started and cooldown has passed
    let battle_start = single_agent.battle_start_time.ok_or(GameError::BattleNotStarted)?;
    require!(now >= battle_start + AGENT_VS_ALLIANCE_COOLDOWN, GameError::BattleNotReadyToResolve);

    // Update last_attack cooldown
    single_agent.validate_attack(now)?;
    single_agent.last_attack = now;
    alliance_leader.last_attack = now;
    alliance_partner.last_attack = now;

    // Clear battle_start_time after resolution
    single_agent.battle_start_time = None;
    alliance_leader.battle_start_time = None;
    alliance_partner.battle_start_time = None;

    // Unpack token accounts
    let single_token_data = SplTokenAccount::unpack_from_slice(&ctx.accounts.single_agent_token.data.borrow())?;
    let alliance_leader_data = SplTokenAccount::unpack_from_slice(&ctx.accounts.alliance_leader_token.data.borrow())?;
    let alliance_partner_data = SplTokenAccount::unpack_from_slice(&ctx.accounts.alliance_partner_token.data.borrow())?;

    // The alliance total balance is alliance_leader + alliance_partner
    let alliance_balance = alliance_leader_data.amount
        .checked_add(alliance_partner_data.amount)
        .ok_or(GameError::InsufficientFunds)?;

    if agent_is_winner {
        // Single agent is winner, alliance is loser.
        // Compute the total lost amount.
        let total_lost = alliance_balance
            .checked_mul(percent_lost as u64).ok_or(GameError::InsufficientFunds)?
            .checked_div(100).ok_or(GameError::InsufficientFunds)?;

        // Distribute loss proportionally to alliance leader and partner
        let leader_deduction: u64 = if alliance_balance > 0 {
            (((total_lost as u128) * (alliance_leader_data.amount as u128))
                / (alliance_balance as u128)) as u64
        } else { 0 };
        let partner_deduction = total_lost.checked_sub(leader_deduction).ok_or(GameError::InsufficientFunds)?;

        // Transfer from alliance_leader_token -> single_agent_token
        if leader_deduction > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.alliance_leader_token.to_account_info(),
                to: ctx.accounts.single_agent_token.to_account_info(),
                authority: ctx.accounts.alliance_leader_authority.to_account_info(),
            };
            transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), leader_deduction)?;
        }
        // Transfer from alliance_partner_token -> single_agent_token
        if partner_deduction > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.alliance_partner_token.to_account_info(),
                to: ctx.accounts.single_agent_token.to_account_info(),
                authority: ctx.accounts.alliance_partner_authority.to_account_info(),
            };
            transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), partner_deduction)?;
        }

        emit!(BattleResolved {
            winner_id: single_agent.id,
            loser_id: alliance_leader.id, // Assuming alliance_leader represents the alliance
            transfer_amount: total_lost,
        });
    } else {
        // Alliance is winner, single agent is loser.
        // Compute the lost amount from the single agent's balance.
        let single_balance = single_token_data.amount;
        let lost_amount = single_balance
            .checked_mul(percent_lost as u64).ok_or(GameError::InsufficientFunds)?
            .checked_div(100).ok_or(GameError::InsufficientFunds)?;

        let half_loss = lost_amount.checked_div(2).ok_or(GameError::InsufficientFunds)?;
        let remainder = lost_amount.checked_sub(half_loss).ok_or(GameError::InsufficientFunds)?;

        // Transfer half to alliance leader.
        if half_loss > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.single_agent_token.to_account_info(),
                to: ctx.accounts.alliance_leader_token.to_account_info(),
                authority: ctx.accounts.single_agent_authority.to_account_info(),
            };
            transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), half_loss)?;
        }
        // Transfer half (or remainder) to alliance partner.
        if remainder > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.single_agent_token.to_account_info(),
                to: ctx.accounts.alliance_partner_token.to_account_info(),
                authority: ctx.accounts.single_agent_authority.to_account_info(),
            };
            transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), remainder)?;
        }

        emit!(BattleResolved {
            winner_id: alliance_leader.id, // Assuming alliance_leader represents the alliance
            loser_id: single_agent.id,
            transfer_amount: lost_amount,
        });
    }

    Ok(())
}

/// Resolves a battle between two alliances after cooldown.
pub fn resolve_battle_alliance_vs_alliance(
    ctx: Context<ResolveBattleAlliances>,
    percent_lost: u8,
    alliance_a_wins: bool,
) -> Result<()> {
    let authority = &ctx.accounts.authority;
    let game = &ctx.accounts.game;
    require!(authority.key() == game.authority, GameError::Unauthorized);

    let now = Clock::get()?.unix_timestamp;

    // Alliances A and B
    let leader_a = &mut ctx.accounts.leader_a;
    let partner_a = &mut ctx.accounts.partner_a;
    let leader_b = &mut ctx.accounts.leader_b;
    let partner_b = &mut ctx.accounts.partner_b;

    // Ensure battle has started and cooldown has passed
    let battle_start_a = leader_a.battle_start_time.ok_or(GameError::BattleNotStarted)?;
    let battle_start_b = leader_b.battle_start_time.ok_or(GameError::BattleNotStarted)?;
    require!(now >= battle_start_a + ALLIANCE_VS_ALLIANCE_COOLDOWN, GameError::BattleNotReadyToResolve);
    require!(now >= battle_start_b + ALLIANCE_VS_ALLIANCE_COOLDOWN, GameError::BattleNotReadyToResolve);

    // Update last_attack cooldown
    leader_a.validate_attack(now)?;
    leader_a.last_attack = now;
    partner_a.validate_attack(now)?;
    partner_a.last_attack = now;
    leader_b.validate_attack(now)?;
    leader_b.last_attack = now;
    partner_b.validate_attack(now)?;
    partner_b.last_attack = now;

    // Clear battle_start_time after resolution
    leader_a.battle_start_time = None;
    partner_a.battle_start_time = None;
    leader_b.battle_start_time = None;
    partner_b.battle_start_time = None;

    // Unpack token accounts.
    let leader_a_data = SplTokenAccount::unpack_from_slice(&ctx.accounts.leader_a_token.data.borrow())?;
    let partner_a_data = SplTokenAccount::unpack_from_slice(&ctx.accounts.partner_a_token.data.borrow())?;
    let leader_b_data = SplTokenAccount::unpack_from_slice(&ctx.accounts.leader_b_token.data.borrow())?;
    let partner_b_data = SplTokenAccount::unpack_from_slice(&ctx.accounts.partner_b_token.data.borrow())?;

    let alliance_a_balance = leader_a_data.amount.checked_add(partner_a_data.amount).ok_or(GameError::InsufficientFunds)?;
    let alliance_b_balance = leader_b_data.amount.checked_add(partner_b_data.amount).ok_or(GameError::InsufficientFunds)?;

    if alliance_a_wins {
        // Alliance A wins, Alliance B loses.
        let total_lost = alliance_b_balance
            .checked_mul(percent_lost as u64).ok_or(GameError::InsufficientFunds)?
            .checked_div(100).ok_or(GameError::InsufficientFunds)?;

        let leader_b_deduction: u64 = if alliance_b_balance > 0 {
            (((total_lost as u128) * (leader_b_data.amount as u128))
                / (alliance_b_balance as u128)) as u64
        } else { 0 };
        let partner_b_deduction = total_lost.checked_sub(leader_b_deduction).ok_or(GameError::InsufficientFunds)?;

        // Transfer from alliance_b_leader_token -> alliance_a_leader_token
        if leader_b_deduction > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.leader_b_token.to_account_info(),
                to: ctx.accounts.leader_a_token.to_account_info(),
                authority: ctx.accounts.leader_b_authority.to_account_info(),
            };
            transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), leader_b_deduction)?;
        }
        // Transfer from alliance_b_partner_token -> alliance_a_partner_token
        if partner_b_deduction > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.partner_b_token.to_account_info(),
                to: ctx.accounts.partner_a_token.to_account_info(),
                authority: ctx.accounts.partner_b_authority.to_account_info(),
            };
            transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), partner_b_deduction)?;
        }

        emit!(BattleResolved {
            winner_id: leader_a.id, // Assuming alliance A is represented by leader_a
            loser_id: leader_b.id,  // Assuming alliance B is represented by leader_b
            transfer_amount: total_lost,
        });
    } else {
        // Alliance A loses, Alliance B wins.
        let total_lost = alliance_a_balance
            .checked_mul(percent_lost as u64).ok_or(GameError::InsufficientFunds)?
            .checked_div(100).ok_or(GameError::InsufficientFunds)?;

        let leader_a_deduction: u64 = if alliance_a_balance > 0 {
            (((total_lost as u128) * (leader_a_data.amount as u128))
                / (alliance_a_balance as u128)) as u64
        } else { 0 };
        let partner_a_deduction = total_lost.checked_sub(leader_a_deduction).ok_or(GameError::InsufficientFunds)?;

        // Transfer from alliance_a_leader_token -> alliance_b_leader_token
        if leader_a_deduction > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.leader_a_token.to_account_info(),
                to: ctx.accounts.leader_b_token.to_account_info(),
                authority: ctx.accounts.leader_a_authority.to_account_info(),
            };
            transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), leader_a_deduction)?;
        }
        // Transfer from alliance_a_partner_token -> alliance_b_partner_token
        if partner_a_deduction > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.partner_a_token.to_account_info(),
                to: ctx.accounts.partner_b_token.to_account_info(),
                authority: ctx.accounts.partner_a_authority.to_account_info(),
            };
            transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), partner_a_deduction)?;
        }

        emit!(BattleResolved {
            winner_id: leader_b.id, // Assuming alliance B is represented by leader_b
            loser_id: leader_a.id,  // Assuming alliance A is represented by leader_a
            transfer_amount: total_lost,
        });
    }

    Ok(())
}

/// Resolves a simple battle (non-alliance) after cooldown.
pub fn resolve_battle_simple(
    ctx: Context<ResolveBattleSimple>,
    percent_lost: u8,
) -> Result<()> {
    let authority = &ctx.accounts.authority;
    let game = &ctx.accounts.game;
    require!(authority.key() == game.authority, GameError::Unauthorized);

    let now = Clock::get()?.unix_timestamp;
    let winner = &mut ctx.accounts.winner;
    let loser = &mut ctx.accounts.loser;

    // Ensure battle has started and cooldown has passed
    let battle_start = loser.battle_start_time.ok_or(GameError::BattleNotStarted)?;
    require!(now >= battle_start + SIMPLE_BATTLE_COOLDOWN, GameError::BattleNotReadyToResolve);

    // Update last_attack cooldown
    winner.validate_attack(now)?;
    loser.validate_attack(now)?;
    winner.last_attack = now;
    loser.last_attack = now;

    // Clear battle_start_time after resolution
    winner.battle_start_time = None;
    loser.battle_start_time = None;

    let loser_token_account = SplTokenAccount::unpack_from_slice(&ctx.accounts.loser_token.data.borrow())?;
    let lost_amount = loser_token_account.amount
        .checked_mul(percent_lost as u64)
        .ok_or(GameError::InsufficientFunds)?
        .checked_div(100)
        .ok_or(GameError::InsufficientFunds)?;

    let cpi_accounts = Transfer {
        from: ctx.accounts.loser_token.to_account_info(),
        to: ctx.accounts.winner_token.to_account_info(),
        authority: ctx.accounts.loser_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    transfer(CpiContext::new(cpi_program, cpi_accounts), lost_amount)?;

    emit!(BattleResolved {
        winner_id: winner.id,
        loser_id: loser.id,
        transfer_amount: lost_amount,
    });
    Ok(())
}

// -------------------------
// Contexts
// -------------------------

#[derive(Accounts)]
pub struct StartBattleAgentVsAlliance<'info> {
    #[account(mut, has_one = game)]
    pub attacker: Account<'info, Agent>,
    #[account(mut, has_one = game)]
    pub alliance_leader: Account<'info, Agent>,
    #[account(mut, has_one = game)]
    pub alliance_partner: Account<'info, Agent>,
    pub game: Account<'info, Game>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct StartBattleAlliances<'info> {
    #[account(mut, has_one = game)]
    pub leader_a: Account<'info, Agent>,
    #[account(mut, has_one = game)]
    pub partner_a: Account<'info, Agent>,
    #[account(mut, has_one = game)]
    pub leader_b: Account<'info, Agent>,
    #[account(mut, has_one = game)]
    pub partner_b: Account<'info, Agent>,
    pub game: Account<'info, Game>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct StartBattleSimple<'info> {
    #[account(mut, has_one = game)]
    pub winner: Account<'info, Agent>,
    #[account(mut, has_one = game)]
    pub loser: Account<'info, Agent>,
    pub game: Account<'info, Game>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveBattleAgentAlliance<'info> {
    #[account(mut, has_one = game)]
    pub single_agent: Account<'info, Agent>,
    #[account(mut, has_one = game)]
    pub alliance_leader: Account<'info, Agent>,
    #[account(mut, has_one = game)]
    pub alliance_partner: Account<'info, Agent>,
    pub game: Account<'info, Game>,

    /// CHECK: This is the single agent's token account. Validation is done in program logic.
    #[account(mut)]
    pub single_agent_token: UncheckedAccount<'info>,
    /// CHECK: This is the alliance leader's token account. Validation is done in program logic.
    #[account(mut)]
    pub alliance_leader_token: UncheckedAccount<'info>,
    /// CHECK: This is the alliance partner's token account. Validation is done in program logic.
    #[account(mut)]
    pub alliance_partner_token: UncheckedAccount<'info>,

    /// CHECK: This is the authority of the single agent. Validation is done in program logic.
    #[account(signer)]
    pub single_agent_authority: AccountInfo<'info>,
    /// CHECK: This is the authority of the alliance leader. Validation is done in program logic.
    #[account(signer)]
    pub alliance_leader_authority: AccountInfo<'info>,
    /// CHECK: This is the authority of the alliance partner. Validation is done in program logic.
    #[account(signer)]
    pub alliance_partner_authority: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveBattleAlliances<'info> {
    #[account(mut, has_one = game)]
    pub leader_a: Account<'info, Agent>,
    #[account(mut, has_one = game)]
    pub partner_a: Account<'info, Agent>,

    #[account(mut, has_one = game)]
    pub leader_b: Account<'info, Agent>,
    #[account(mut, has_one = game)]
    pub partner_b: Account<'info, Agent>,

    pub game: Account<'info, Game>,

    /// CHECK: This is the token account for leader A. Validation is done in program logic.
    #[account(mut)]
    pub leader_a_token: UncheckedAccount<'info>,
    /// CHECK: This is the token account for partner A. Validation is done in program logic.
    #[account(mut)]
    pub partner_a_token: UncheckedAccount<'info>,
    /// CHECK: This is the token account for leader B. Validation is done in program logic.
    #[account(mut)]
    pub leader_b_token: UncheckedAccount<'info>,
    /// CHECK: This is the token account for partner B. Validation is done in program logic.
    #[account(mut)]
    pub partner_b_token: UncheckedAccount<'info>,

    /// CHECK: This is the authority of leader A. Validation is done in program logic.
    #[account(signer)]
    pub leader_a_authority: AccountInfo<'info>,
    /// CHECK: This is the authority of partner A. Validation is done in program logic.
    #[account(signer)]
    pub partner_a_authority: AccountInfo<'info>,
    /// CHECK: This is the authority of leader B. Validation is done in program logic.
    #[account(signer)]
    pub leader_b_authority: AccountInfo<'info>,
    /// CHECK: This is the authority of partner B. Validation is done in program logic.
    #[account(signer)]
    pub partner_b_authority: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveBattleSimple<'info> {
    #[account(mut, has_one = game)]
    pub winner: Account<'info, Agent>,
    #[account(mut, has_one = game)]
    pub loser: Account<'info, Agent>,
    pub game: Account<'info, Game>,

    /// CHECK: This is the token account for the winner. Validation is done in program logic.
    #[account(mut)]
    pub winner_token: UncheckedAccount<'info>,
    /// CHECK: This is the token account for the loser. Validation is done in program logic.
    #[account(mut)]
    pub loser_token: UncheckedAccount<'info>,

    /// CHECK: This is the authority of the loser. Validation is done in program logic.
    #[account(signer)]
    pub loser_authority: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResetBattleTimes<'info> {
    // Each of these is optional. If you don't need 4, you can do fewer or a dynamic approach.
    #[account(mut)]
    pub agent1: Account<'info, Agent>,
    #[account(mut)]
    pub agent2: Account<'info, Agent>,
    #[account(mut)]
    pub agent3: Account<'info, Agent>,
    #[account(mut)]
    pub agent4: Account<'info, Agent>,

    // The authority allowed to do this test-only reset,
    // typically the same as `game.authority` or your test wallet.
    pub authority: Signer<'info>,
}

/// A test-only instruction that forcibly resets the battle-related timestamps
/// for up to 4 agents, clearing `battle_start_time`, `last_attack`, etc.
pub fn reset_battle_times(ctx: Context<ResetBattleTimes>) -> Result<()> {
    // agent1
    let a1 = &mut ctx.accounts.agent1;
    a1.battle_start_time = None;
    a1.last_attack = 0;
    a1.next_move_time = 0;
    
    // agent2
    let a2 = &mut ctx.accounts.agent2;
    a2.battle_start_time = None;
    a2.last_attack = 0;
    a2.next_move_time = 0;

    // agent3
    let a3 = &mut ctx.accounts.agent3;
    a3.battle_start_time = None;
    a3.last_attack = 0;
    a3.next_move_time = 0;

    // agent4
    let a4 = &mut ctx.accounts.agent4;
    a4.battle_start_time = None;
    a4.last_attack = 0;
    a4.next_move_time = 0;

    Ok(())
}

