use anchor_lang::prelude::*;
use crate::state::{Agent, Game, StakeInfo};
use crate::error::GameError;
use crate::constants::*;

/// Stake tokens (EIP-4626 style). Converts deposits into proportional shares.
pub fn stake_tokens(ctx: Context<StakeTokens>, deposit_amount: u64) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let stake_info = &mut ctx.accounts.stake_info;

    require!(deposit_amount <= MAX_STAKE_AMOUNT, GameError::MaxStakeExceeded);

    let total_value: u64 = agent.token_balance;
    // Assume agent.total_shares is of type u128.
    let total_shares: u128 = agent.total_shares;

    // Determine the number of shares to mint.
    let shares_to_mint: u64 = if total_value == 0 || total_shares == 0 {
        deposit_amount
    } else {
        deposit_amount
            .checked_mul(total_shares.try_into().unwrap())
            .ok_or_else(|| error!(GameError::NotEnoughTokens))?
            .checked_div(total_value)
            .ok_or_else(|| error!(GameError::NotEnoughTokens))?
    };

    // Update the vault (Agent).
    agent.token_balance = agent.token_balance
        .checked_add(deposit_amount)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;
    agent.total_shares = agent.total_shares
        .checked_add(u128::from(shares_to_mint))
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    // Update the staker's record.
    stake_info.amount = stake_info.amount
        .checked_add(deposit_amount)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;
    stake_info.shares = stake_info.shares
        .checked_add(shares_to_mint)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;


    Ok(())
}

/// Unstake tokens by redeeming shares.
pub fn unstake_tokens(ctx: Context<UnstakeTokens>, shares_to_redeem: u64) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let stake_info = &mut ctx.accounts.stake_info;

    require!(stake_info.shares >= shares_to_redeem, GameError::NotEnoughTokens);

    let total_value: u64 = agent.token_balance;
    let total_shares: u128 = agent.total_shares;

    // Calculate tokens to withdraw.
    let withdraw_amount = shares_to_redeem
        .checked_mul(total_value)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?
        .checked_div(total_shares.try_into().unwrap())
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    // Update vault.
    agent.token_balance = agent.token_balance
        .checked_sub(withdraw_amount)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;
    agent.total_shares = agent.total_shares
        .checked_sub(u128::from(shares_to_redeem))
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    // Update staker's record.
    stake_info.amount = stake_info.amount
        .checked_sub(withdraw_amount)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;
    stake_info.shares = stake_info.shares
        .checked_sub(shares_to_redeem)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    Ok(())
}

/// Claim rewards if at least 24 hours have passed.
/// Rewards are accrued based on elapsed time, daily rate, and user share fraction.
pub fn claim_staking_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let stake_info = &mut ctx.accounts.stake_info;
    let now = Clock::get()?.unix_timestamp;

    // Enforce a 24-hour cooldown.
    require!(
        now >= stake_info.last_reward_timestamp + REWARD_CLAIM_COOLDOWN,
        GameError::ClaimCooldown
    );

    let time_elapsed = (now - stake_info.last_reward_timestamp) as u64;
    let day_fraction = (time_elapsed as f64) / 86400.0;

    if agent.total_shares == 0 {
        return Ok(());
    }
    let user_fraction = (stake_info.shares as f64) / (agent.total_shares as f64);
    let total_value = agent.token_balance as f64;

    let reward_float = day_fraction * DAILY_REWARD_RATE * user_fraction * total_value;
    let reward_amount = reward_float.floor() as u64;

    agent.token_balance = agent.token_balance
        .checked_add(reward_amount)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;
    stake_info.amount = stake_info.amount
        .checked_add(reward_amount)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    stake_info.last_reward_timestamp = now;
    agent.last_reward_claim = now;

    Ok(())
}

/// ========== Contexts for Token Instructions ==========

#[derive(Accounts)]
pub struct StakeTokens<'info> {
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,

    pub game: Account<'info, Game>,

    // We use `init` (which always creates a new account).
    // (If you need conditional initialization, you must handle that externally.)
    #[account(
        init,
        payer = authority,
        seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()],
        bump,
        space = 8 + StakeInfo::INIT_SPACE
    )]
    pub stake_info: Account<'info, StakeInfo>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnstakeTokens<'info> {
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,

    pub game: Account<'info, Game>,

    #[account(
        mut,
        seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()],
        bump
    )]
    pub stake_info: Account<'info, StakeInfo>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,

    pub game: Account<'info, Game>,

    #[account(
        mut,
        seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()],
        bump
    )]
    pub stake_info: Account<'info, StakeInfo>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}
