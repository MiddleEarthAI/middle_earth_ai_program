use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;
use crate::constants::*;

pub fn stake_tokens(ctx: Context<StakeTokens>, amount: u64) -> Result<()> {
    let agent = &mut ctx.accounts.agent;

    // Example check: ensure it doesn't exceed MAX_STAKE_AMOUNT
    require!(amount <= MAX_STAKE_AMOUNT, GameError::MaxStakeExceeded);

    // Increase staked balance
    agent.staked_balance = agent.staked_balance.checked_add(amount).unwrap();

    // TODO: anchor-spl transfer logic to the agent's vault
    Ok(())
}

pub fn unstake_tokens(ctx: Context<UnstakeTokens>, amount: u64) -> Result<()> {
    let agent = &mut ctx.accounts.agent;

    // Make sure we have enough staked
    require!(agent.staked_balance >= amount, GameError::NotEnoughTokens);

    agent.staked_balance = agent.staked_balance.checked_sub(amount).unwrap();
    // TODO: anchor-spl transfer logic from the agent's vault back to user
    Ok(())
}

pub fn claim_staking_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let now = Clock::get()?.unix_timestamp;

    // Example: ensure some time has passed since last_reward_claim
    // require!(now >= agent.last_reward_claim + REWARD_CLAIM_COOLDOWN, GameError::ClaimCooldown);

    // Calculate rewards ...
    // Transfer them to authority ...
    agent.last_reward_claim = now;

    Ok(())
}

#[derive(Accounts)]
pub struct StakeTokens<'info> {
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UnstakeTokens<'info> {
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub authority: Signer<'info>,
}
