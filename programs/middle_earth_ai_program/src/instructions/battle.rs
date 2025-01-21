use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack; // For unpack_from_slice
use anchor_spl::token::{transfer, Transfer, Token};
use spl_token::state::Account as SplTokenAccount; // Import SPL Token Account
use crate::state::{Agent, Game};
use crate::error::GameError;
use crate::events::*; // Ensure BattleResolved event is defined

/// Resolves a battle with alliance support with token transfers. 
/// It updates cooldown timers and transfers tokens as follows:
/// - Computes the total lost amount as `percent_lost`% of the sum of the loser's and loser partner's token balances.
/// - Deducts from each losing account proportionally.
/// - Distributes the total lost amount among the winners (winner and winner partner) in proportion
///   to their token balances.
pub fn resolve_battle_agent_vs_alliance(
    ctx: Context<ResolveBattleAgentAlliance>,
    percent_lost: u8,
    // "agent_is_winner" param indicates if the single agent is the winner or loser.
    agent_is_winner: bool,
) -> Result<()> {
    let authority = &ctx.accounts.authority;
    let game = &ctx.accounts.game;
    require!(authority.key() == game.authority, GameError::Unauthorized);

    let now = Clock::get()?.unix_timestamp;

    // Agents
    let single_agent = &mut ctx.accounts.single_agent;
    let alliance_leader = &mut ctx.accounts.alliance_leader;
    let alliance_partner = &mut ctx.accounts.alliance_partner;

    // Update last_attack cooldown
    single_agent.validate_attack(now)?;
    single_agent.last_attack = now;
    alliance_leader.last_attack = now;
    alliance_partner.last_attack = now;

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
        
        // Use u128 math to avoid overflow.
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
    }

    Ok(())
}

/// If alliance battles another alliance. 
/// We assume each side has a "leader" and "partner".
/// The losing side is determined externally by an argument `alliance_a_wins`.
/// If `alliance_a_wins` is `true`, alliance A is winner. Otherwise alliance B is winner.
/// We take the losing alliance's balance, apply `percent_lost`, and distribute among the winners.
pub fn resolve_battle_alliance_vs_alliance(
    ctx: Context<ResolveBattleAlliances>,
    percent_lost: u8,
    alliance_a_wins: bool,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // Alliance A: (leaderA, partnerA)
    let leaderA = &mut ctx.accounts.leader_a;
    let partnerA = &mut ctx.accounts.partner_a;
    // Alliance B: (leaderB, partnerB)
    let leaderB = &mut ctx.accounts.leader_b;
    let partnerB = &mut ctx.accounts.partner_b;

    // Update last_attack fields.
    leaderA.validate_attack(now)?;
    leaderA.last_attack = now;
    partnerA.last_attack = now;
    leaderB.last_attack = now;
    partnerB.last_attack = now;

    // Unpack token accounts.
    let leaderA_data = SplTokenAccount::unpack_from_slice(&ctx.accounts.leader_a_token.data.borrow())?;
    let partnerA_data = SplTokenAccount::unpack_from_slice(&ctx.accounts.partner_a_token.data.borrow())?;
    let leaderB_data = SplTokenAccount::unpack_from_slice(&ctx.accounts.leader_b_token.data.borrow())?;
    let partnerB_data = SplTokenAccount::unpack_from_slice(&ctx.accounts.partner_b_token.data.borrow())?;

    let alliance_a_balance = leaderA_data.amount.checked_add(partnerA_data.amount).ok_or(GameError::InsufficientFunds)?;
    let alliance_b_balance = leaderB_data.amount.checked_add(partnerB_data.amount).ok_or(GameError::InsufficientFunds)?;

    if alliance_a_wins {
        // Alliance B loses.
        let total_lost = alliance_b_balance
            .checked_mul(percent_lost as u64).ok_or(GameError::InsufficientFunds)?
            .checked_div(100).ok_or(GameError::InsufficientFunds)?;

        let leader_b_deduction: u64 = if alliance_b_balance > 0 {
            (((total_lost as u128) * (leaderB_data.amount as u128))
                / (alliance_b_balance as u128)) as u64
        } else { 0 };
        let partner_b_deduction = total_lost.checked_sub(leader_b_deduction).ok_or(GameError::InsufficientFunds)?;

        if leader_b_deduction > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.leader_b_token.to_account_info(),
                to: ctx.accounts.leader_a_token.to_account_info(),
                authority: ctx.accounts.leader_b_authority.to_account_info(),
            };
            transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), leader_b_deduction)?;
        }
        if partner_b_deduction > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.partner_b_token.to_account_info(),
                to: ctx.accounts.partner_a_token.to_account_info(),
                authority: ctx.accounts.partner_b_authority.to_account_info(),
            };
            transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), partner_b_deduction)?;
        }
    } else {
        // Alliance A loses.
        let total_lost = alliance_a_balance
            .checked_mul(percent_lost as u64).ok_or(GameError::InsufficientFunds)?
            .checked_div(100).ok_or(GameError::InsufficientFunds)?;

        let leader_a_deduction: u64 = if alliance_a_balance > 0 {
            (((total_lost as u128) * (leaderA_data.amount as u128))
                / (alliance_a_balance as u128)) as u64
        } else { 0 };
        let partner_a_deduction = total_lost.checked_sub(leader_a_deduction).ok_or(GameError::InsufficientFunds)?;

        if leader_a_deduction > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.leader_a_token.to_account_info(),
                to: ctx.accounts.leader_b_token.to_account_info(),
                authority: ctx.accounts.leader_a_authority.to_account_info(),
            };
            transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), leader_a_deduction)?;
        }
        if partner_a_deduction > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.partner_a_token.to_account_info(),
                to: ctx.accounts.partner_b_token.to_account_info(),
                authority: ctx.accounts.partner_a_authority.to_account_info(),
            };
            transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), partner_a_deduction)?;
        }
    }

    Ok(())
}

/// Resolve a simple battle (non‐alliance) with token transfer.
/// The loser loses `percent_lost` percent of its token balance, and that lost amount is transferred 
/// directly to the winner’s token account.
pub fn resolve_battle_simple(
    ctx: Context<ResolveBattleSimple>,
    percent_lost: u8,
) -> Result<()> {
    let authority = &ctx.accounts.authority;
    let game = &ctx.accounts.game;
    require!(authority.key() == game.authority, GameError::Unauthorized);

    let winner = &mut ctx.accounts.winner;
    let loser = &mut ctx.accounts.loser;
    let now = Clock::get()?.unix_timestamp;
    winner.validate_attack(now)?;
    winner.last_attack = now;
    loser.last_attack = now;

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
    #[account(mut)]
    pub partner_a: Account<'info, Agent>,

    #[account(mut, has_one = game)]
    pub leader_b: Account<'info, Agent>,
    #[account(mut)]
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
