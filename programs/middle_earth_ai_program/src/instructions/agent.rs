use crate::error::GameError;
use crate::state::{Agent, Game};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer, Token, TokenAccount};
use borsh::BorshDeserialize;

pub fn register_agent(
    ctx: Context<RegisterAgent>,
    agent_id: u8,
    x: i32,
    y: i32,
    name: String,
) -> Result<()> {
    let game_account = &mut ctx.accounts.game;
    // Only allow if the signer is the game authority.
    require!(
        ctx.accounts.authority.key() == game_account.authority,
        GameError::Unauthorized
    );

    let agent_account = &mut ctx.accounts.agent;

    // Ensure the game is active.
    require!(game_account.is_active, GameError::GameNotActive);

    // Ensure the agent is not already registered.
    let agent_key = agent_account.key();
    require!(
        !game_account.agents.iter().any(|a| a.key == agent_key),
        GameError::AgentAlreadyExists
    );

    // Initialize the agent.
    agent_account.game = game_account.key();
    // For registration we record the game authority as the creator.
    agent_account.authority = ctx.accounts.authority.key();
    agent_account.id = agent_id;
    agent_account.x = x;
    agent_account.y = y;
    agent_account.is_alive = true;
    agent_account.last_move = 0;
    agent_account.staked_balance = 0;
    agent_account.last_battle = 0;
    agent_account.alliance_with = None;
    agent_account.alliance_timestamp = 0;
    agent_account.token_balance = 0;
    agent_account.last_reward_claim = 0;
    agent_account.total_shares = 0;
    agent_account.last_attack = 0;
    agent_account.last_ignore = 0;
    agent_account.last_alliance = 0;
    agent_account.next_move_time = 0;
    agent_account.vault_bump = 0;
    agent_account.last_alliance_agent = None;
    agent_account.last_alliance_broken = 0;
    agent_account.battle_start_time = None;

    // Register the agent in the global list with the provided name.
    game_account.agents.push(crate::state::agent_info::AgentInfo {
        key: agent_key,
        name,
    });

    Ok(())
}

/// Marks an agent as dead by setting its `is_alive` field to false and transfers its token balance to a winner.

pub fn kill_agent(ctx: Context<KillAgent>) -> Result<()> {
    require!(
        ctx.accounts.authority.key() == ctx.accounts.game.authority,
        GameError::Unauthorized
    );

    // Mark the agent as dead.
    let agent_account = &mut ctx.accounts.agent;
    agent_account.is_alive = false;

    // Deserialize the token account data in a separate block so the borrow is dropped afterwards.
    let agent_balance: u64 = {
        let data = ctx.accounts.agent_token.data.borrow();
        let mut slice = &data[..];
        let token_account = TokenAccount::try_deserialize(&mut slice)
            .map_err(|_| error!(GameError::NotEnoughTokens))?;
        token_account.amount
    };

    msg!("Agent token balance: {}", agent_balance);

    // Transfer the entire balance (if any)
    if agent_balance > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.agent_token.to_account_info(),
            to: ctx.accounts.winner_token.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, agent_balance)?;
    }

    Ok(())
}


/// Sets an agent's cooldown (test-only instruction).
pub fn set_agent_cooldown(ctx: Context<SetAgentCooldown>, new_next_move_time: i64) -> Result<()> {
    require!(
        ctx.accounts.authority.key() == ctx.accounts.game.authority,
        GameError::Unauthorized
    );
    let agent = &mut ctx.accounts.agent;
    agent.set_attack_cooldown(new_next_move_time);
    Ok(())
}

/// -------------------------
/// ACCOUNTS
/// -------------------------
#[derive(Accounts)]
#[instruction(agent_id: u8, x: i32, y: i32, name: String)]
pub struct RegisterAgent<'info> {
    #[account(
        mut,
        constraint = game.is_active @ GameError::ReentrancyGuard
    )]
    pub game: Account<'info, Game>,

    /// The Agent account is initialized using PDA seeds.
    #[account(
        init,
        payer = authority,
        seeds = [b"agent", game.key().as_ref(), &[agent_id]],
        bump,
        space = 8 + Agent::INIT_SPACE
    )]
    pub agent: Account<'info, Agent>,

    /// The caller must be the game authority.
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct KillAgent<'info> {
    #[account(mut, has_one = authority)]
    pub agent: Account<'info, Agent>,

    pub game: Account<'info, Game>,

    /// The caller must be the game authority.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: This is the agent's SPL token account.
    /// It must be created with the game authority as its owner.
    #[account(mut)]
    pub agent_token: AccountInfo<'info>,

    /// CHECK: This is the recipient's (winner's) SPL token account.
    #[account(mut)]
    pub winner_token: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}


#[derive(Accounts)]
pub struct SetAgentCooldown<'info> {
    #[account(mut, has_one = game)]
    pub agent: Account<'info, Agent>,
    pub game: Account<'info, Game>,
    /// The caller must be the game authority.
    #[account(mut)]
    pub authority: Signer<'info>,
}
