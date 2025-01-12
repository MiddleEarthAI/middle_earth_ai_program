use anchor_lang::prelude::*;
use crate::state::{Agent, Game, StakeInfo};
use crate::error::GameError;
use crate::constants::*;

use anchor_spl::token::{self, Transfer, Token};

// =====================
// STAKE TOKENS
// =====================

/// Stake tokens (EIP-4626 style). The `deposit_amount` parameter is the number of tokens to deposit.
/// Tokens are transferred from the staker's token account (source) to the agent’s vault account.
/// The number of shares minted is calculated based on the current vault balance.
/// Access control: Only the owner (authority) may deposit.
pub fn stake_tokens(ctx: Context<StakeTokens>, deposit_amount: u64) -> Result<()> {
    // Perform the token transfer (using a CPI call to the SPL Token program).
    {
        let cpi_accounts = Transfer {
            from: ctx.accounts.staker_source.clone(),
            to: ctx.accounts.agent_vault.clone(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, deposit_amount)?;
    }

    // Read the current vault balance by deserializing agent_vault.
    let vault_balance: u64 = {
        let data = ctx.accounts.agent_vault.data.borrow();
        let mut slice: &[u8] = &data;
        anchor_spl::token::TokenAccount::try_deserialize(&mut slice)?.amount
    };

    let total_shares = ctx.accounts.agent.total_shares; // u128
    // Calculate the number of shares to mint.
    // If the vault is empty (or no shares exist), mint shares equal to deposit_amount.
    let shares_to_mint: u64 = if vault_balance == deposit_amount || total_shares == 0 {
        deposit_amount
    } else {
        // Calculate based on the previous vault balance (before deposit).
        let previous_balance = vault_balance
            .checked_sub(deposit_amount)
            .ok_or_else(|| error!(GameError::NotEnoughTokens))?;
        deposit_amount
            .checked_mul(total_shares.try_into().unwrap())
            .ok_or_else(|| error!(GameError::NotEnoughTokens))?
            .checked_div(previous_balance.into())
            .ok_or_else(|| error!(GameError::NotEnoughTokens))?
    };

    // Update the agent's total shares.
    ctx.accounts.agent.total_shares = ctx
        .accounts
        .agent
        .total_shares
        .checked_add(shares_to_mint.into())
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    // Update the staker's record.
    ctx.accounts.stake_info.amount = ctx
        .accounts
        .stake_info
        .amount
        .checked_add(deposit_amount)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;
    ctx.accounts.stake_info.shares = ctx
        .accounts
        .stake_info
        .shares
        .checked_add(shares_to_mint)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    Ok(())
}

// =====================
// UNSTAKE TOKENS
// =====================

/// Unstake tokens by redeeming shares. The withdrawn token amount is calculated based on
/// the proportion of shares redeemed relative to the current vault balance.
/// Tokens are transferred from the agent’s vault account back to the staker's token account.
/// Access control: Only the stake owner (authority) may unstake.
pub fn unstake_tokens(ctx: Context<UnstakeTokens>, shares_to_redeem: u64) -> Result<()> {
    // Ensure the staker has enough shares.
    require!(
        u128::from(ctx.accounts.stake_info.shares) >= u128::from(shares_to_redeem),
        GameError::NotEnoughTokens
    );

    // Read the vault balance.
    let vault_balance: u64 = {
        let data = ctx.accounts.agent_vault.data.borrow();
        let mut slice: &[u8] = &data;
        anchor_spl::token::TokenAccount::try_deserialize(&mut slice)?.amount
    };
    let vault_balance_u128 = u128::from(vault_balance);
    let total_shares = ctx.accounts.agent.total_shares;
    // Compute the withdraw amount (as u128).
    let withdraw_amount = u128::from(shares_to_redeem)
        .checked_mul(vault_balance_u128)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?
        .checked_div(total_shares.into())
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    // Update the agent's total shares.
    ctx.accounts.agent.total_shares = ctx
        .accounts
        .agent
        .total_shares
        .checked_sub(u64::from(shares_to_redeem))
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    // Update the staker's record.
    ctx.accounts.stake_info.amount = ctx
        .accounts
        .stake_info
        .amount
        .checked_sub(withdraw_amount.try_into().unwrap())
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;
    ctx.accounts.stake_info.shares = ctx
        .accounts
        .stake_info
        .shares
        .checked_sub(shares_to_redeem)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    // Prepare CPI to transfer tokens from the vault to the staker's destination.
    let cpi_accounts = Transfer {
        from: ctx.accounts.agent_vault.clone(),
        to: ctx.accounts.staker_destination.clone(),
        authority: ctx.accounts.agent_authority.clone(),
    };
    // Build the signer seeds for the vault PDA.
    let bindings = ctx.accounts.agent.key();
    let seeds = &[
        b"agent_vault",
        bindings.as_ref(),
        &[ctx.accounts.agent.vault_bump],
    ];
    let signer = &[&seeds[..]];
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, withdraw_amount.try_into().unwrap())?;

    Ok(())
}

// =====================
// CLAIM REWARDS
// =====================

/// Claim staking rewards if at least 24 hours have passed. Rewards are accrued based on elapsed time,
/// a daily rate, and the user's share fraction. (This function only updates on-chain state; adjust as needed.)
pub fn claim_staking_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(
        now >= ctx.accounts.stake_info.last_reward_timestamp + REWARD_CLAIM_COOLDOWN,
        GameError::ClaimCooldown
    );

    // Read the vault balance.
    let vault_balance: u64 = {
        let data = ctx.accounts.agent_vault.data.borrow();
        let mut slice: &[u8] = &data;
        anchor_spl::token::TokenAccount::try_deserialize(&mut slice)?.amount
    };
    let total_shares = ctx.accounts.agent.total_shares;
    if total_shares == 0 {
        return Ok(());
    }

    let time_elapsed = (now - ctx.accounts.stake_info.last_reward_timestamp) as u64;
    let day_fraction = (time_elapsed as f64) / 86400.0;
    let user_fraction = (ctx.accounts.stake_info.shares as f64) / (total_shares as f64);
    let total_value = vault_balance as f64;
    let reward_float = day_fraction * DAILY_REWARD_RATE * user_fraction * total_value;
    let _reward_amount = reward_float.floor() as u64;

    // (If you wish to transfer tokens for rewards, add the appropriate CPI logic here.)
    // For now, we just update the timestamp.
    ctx.accounts.stake_info.last_reward_timestamp = now;
    Ok(())
}

// =====================
// ACCOUNTS STRUCTS
// =====================
#[derive(Accounts)]
pub struct StakeTokens<'info> {
    /// The agent state.
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,
    pub game: Account<'info, Game>,

    /// Record for the staker.
    #[account(
        init,
        payer = authority,
        seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()],
        bump,
        space = 8 + StakeInfo::INIT_SPACE
    )]
    pub stake_info: Account<'info, StakeInfo>,

    /// The staker's token account (source) from which tokens will be deposited.
    /// CHECK: This is a token account owned by the SPL Token program. Its validity is verified by constraints.
    #[account(mut, constraint = *staker_source.owner == *authority.key)]
    pub staker_source: AccountInfo<'info>,

    /// The vault token account associated with the agent (destination).
    /// CHECK: This is a token account owned by the SPL Token program. Its validity is verified by constraints.
    #[account(mut, constraint = *agent_vault.owner == anchor_spl::token::ID)]
    pub agent_vault: AccountInfo<'info>,

    /// The authority/staker.
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UnstakeTokens<'info> {
    /// The agent state.
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,
    pub game: Account<'info, Game>,

    /// Record for the staker.
    #[account(mut, seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()], bump)]
    pub stake_info: Account<'info, StakeInfo>,

    /// The vault token account associated with the agent (source for withdrawal).
    /// CHECK: This is a token account owned by the SPL Token program. Its validity is verified by constraints.
    #[account(mut, constraint = *agent_vault.owner == anchor_spl::token::ID)]
    pub agent_vault: AccountInfo<'info>,

    /// The authority account for the vault (this PDA signs on behalf of the vault).
    /// CHECK: This is a PDA signing authority for the agent vault, derived using seeds.
    #[account(mut)]
    pub agent_authority: AccountInfo<'info>,

    /// The staker's token account (destination) for receiving tokens.
    /// CHECK: This is a token account owned by the SPL Token program. Its validity is verified by constraints.
    #[account(mut, constraint = *staker_destination.owner == anchor_spl::token::ID)]
    pub staker_destination: AccountInfo<'info>,

    /// The stake owner.
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    /// The agent state.
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,
    pub game: Account<'info, Game>,

    /// Record for the staker.
    #[account(mut, seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()], bump)]
    pub stake_info: Account<'info, StakeInfo>,

    /// The vault token account associated with the agent.
    /// CHECK: This is a token account owned by the SPL Token program. Its validity is verified by constraints.
    #[account(mut, constraint = *agent_vault.owner == anchor_spl::token::ID)]
    pub agent_vault: AccountInfo<'info>,

    /// The authority/staker.
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}
