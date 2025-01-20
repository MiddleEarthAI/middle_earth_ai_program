use anchor_lang::prelude::*;
use crate::state::{Agent, Game, StakeInfo};
use crate::error::GameError;
use crate::constants::*;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::token::{self, Transfer, Token, Mint, TokenAccount};

/// Example daily distribution of 500,000 tokens
pub const DAILY_REWARD_TOKENS: u64 = 500_000;

/// Stake tokens (EIP-4626 style). The `deposit_amount` parameter is the number of tokens to deposit.
/// Tokens are transferred from the staker's token account (source) to the agent’s vault account.
/// The number of shares minted is calculated based on the current vault balance.
/// Access control: Only the owner (authority) may deposit.
pub fn stake_tokens(ctx: Context<StakeTokens>, deposit_amount: u64) -> Result<()> {
    // 1) Perform the token transfer (using a CPI call to the SPL Token program).
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

    // 2) Read the current vault balance by deserializing agent_vault.
    let vault_balance: u64 = {
        let data = ctx.accounts.agent_vault.data.borrow();
        let mut slice: &[u8] = &data;
        anchor_spl::token::TokenAccount::try_deserialize(&mut slice)?.amount
    };

    let total_shares = ctx.accounts.agent.total_shares; // u128
    // 3) Calculate the number of shares to mint.
    let shares_to_mint: u64 = if vault_balance == deposit_amount || total_shares == 0 {
        deposit_amount
    } else {
        let previous_balance = vault_balance
            .checked_sub(deposit_amount)
            .ok_or_else(|| error!(GameError::NotEnoughTokens))?;
        deposit_amount
            .checked_mul(total_shares.try_into().unwrap())
            .ok_or_else(|| error!(GameError::NotEnoughTokens))?
            .checked_div(previous_balance.into())
            .ok_or_else(|| error!(GameError::NotEnoughTokens))?
    };

    // 4) Update the agent's total shares.
    ctx.accounts.agent.total_shares = ctx
        .accounts
        .agent
        .total_shares
        .checked_add(shares_to_mint.into())
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    // 5) Update the staker's record.
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

/// Unstake tokens by redeeming shares. The withdrawn token amount is calculated based on
/// the proportion of shares redeemed relative to the current vault balance.
/// Tokens are transferred from the agent’s vault account back to the staker's token account.
/// Access control: Only the stake owner (authority) may unstake.
pub fn unstake_tokens(ctx: Context<UnstakeTokens>, shares_to_redeem: u64) -> Result<()> {
    // 1) Ensure the staker has enough shares.
    require!(
        u128::from(ctx.accounts.stake_info.shares) >= u128::from(shares_to_redeem),
        GameError::NotEnoughTokens
    );

    // 2) Read the vault balance.
    let vault_balance: u64 = {
        let data = ctx.accounts.agent_vault.data.borrow();
        let mut slice: &[u8] = &data;
        anchor_spl::token::TokenAccount::try_deserialize(&mut slice)?.amount
    };
    let vault_balance_u128 = u128::from(vault_balance);
    let total_shares = ctx.accounts.agent.total_shares;
    // 3) Proportional withdrawal.
    let withdraw_amount = u128::from(shares_to_redeem)
        .checked_mul(vault_balance_u128)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?
        .checked_div(total_shares.into())
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    // 4) Update the agent's total shares.
    ctx.accounts.agent.total_shares = ctx
        .accounts
        .agent
        .total_shares
        .checked_sub(u64::from(shares_to_redeem))
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    // 5) Update the staker's record.
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

    // 6) Prepare CPI to transfer tokens from the vault to the staker's destination.
    let cpi_accounts = Transfer {
        from: ctx.accounts.agent_vault.clone(),
        to: ctx.accounts.staker_destination.clone(),
        authority: ctx.accounts.agent_authority.clone(),
    };
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

/// Claim staking rewards if at least 24 hours have passed.
/// This version reads the total supply from the mint, calculates the user's fraction of the total supply,
/// multiplies it by DAILY_REWARD_TOKENS, and transfers that amount from the rewards vault to the staker's destination.
/// Instead of using the staked amount as the basis, we use the staker’s token account balance.
pub fn claim_staking_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ctx.accounts.stake_info.last_reward_timestamp + REWARD_CLAIM_COOLDOWN,
        GameError::ClaimCooldown
    );

    // 1) Read total supply from the Mint.
    let mint_data = ctx.accounts.mint.data.borrow();
    let mut mint_slice: &[u8] = &mint_data;
    let mint_state = spl_token::state::Mint::unpack(&mut mint_slice)?;
    let total_supply = mint_state.supply;
    if total_supply == 0 {
        return Ok(());
    }

    // 2) Read the staker’s token account balance from staker_destination.
    let staker_data = {
        let data = ctx.accounts.staker_destination.data.borrow();
        let mut slice: &[u8] = &data;
        anchor_spl::token::TokenAccount::try_deserialize(&mut slice)?.amount
    };
    // If the staker’s token account balance is zero, return early.
    if staker_data == 0 {
        return Ok(());
    }

    // 3) Compute fraction = staker_balance / total_supply.
    let fraction = (staker_data as f64) / (total_supply as f64);

    // 4) Compute user_reward = fraction * DAILY_REWARD_TOKENS.
    let user_reward_float = fraction * (DAILY_REWARD_TOKENS as f64);
    let user_reward = user_reward_float.floor() as u64;
    if user_reward == 0 {
        return Ok(());
    }

    // 5) Transfer from rewards_vault -> staker_destination.
    {
        let cpi_accounts = Transfer {
            from: ctx.accounts.rewards_vault.to_account_info(),
            to: ctx.accounts.staker_destination.to_account_info(),
            authority: ctx.accounts.rewards_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, user_reward)?;
    }

    // 6) Update last_reward_timestamp.
    ctx.accounts.stake_info.last_reward_timestamp = now;

    Ok(())
}

// --------------------
// ACCOUNTS
// --------------------

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
    /// CHECK: This is a token account owned by the staker.
    #[account(mut, constraint = *staker_source.owner == *authority.key)]
    pub staker_source: AccountInfo<'info>,

    /// The agent’s vault token account (destination).
    /// CHECK: This token account is owned by the SPL Token program.
    #[account(mut, constraint = *agent_vault.owner == anchor_spl::token::ID)]
    pub agent_vault: AccountInfo<'info>,

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

    #[account(mut, seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()], bump)]
    pub stake_info: Account<'info, StakeInfo>,

    /// The agent's vault token account (source for withdrawal).
    /// CHECK: This is a token account owned by the SPL Token program.
    #[account(mut, constraint = *agent_vault.owner == anchor_spl::token::ID)]
    pub agent_vault: AccountInfo<'info>,

    /// The PDA that signs on behalf of the agent vault.
    /// CHECK: Correctness ensured by seeds.
    #[account(mut)]
    pub agent_authority: AccountInfo<'info>,

    /// The staker's token account (destination) to receive withdrawn tokens.
    /// CHECK: This is a token account owned by the SPL Token program.
    #[account(mut, constraint = *staker_destination.owner == anchor_spl::token::ID)]
    pub staker_destination: AccountInfo<'info>,

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

    #[account(
        mut,
        seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()],
        bump
    )]
    pub stake_info: Account<'info, StakeInfo>,

    /// The mint from which we read the total supply.
    /// CHECK: We manually deserialize the mint data.
    pub mint: UncheckedAccount<'info>,

    /// The rewards vault from which reward tokens will be transferred.
    /// CHECK: This is a token account owned by the SPL Token program.
    #[account(mut)]
    pub rewards_vault: AccountInfo<'info>,
    /// The authority over the rewards vault.
    /// CHECK: This must be able to authorize transfers.
    #[account(mut)]
    pub rewards_authority: AccountInfo<'info>,

    /// The staker's token account to receive the reward.
    /// CHECK: This is a token account owned by the SPL Token program.
    #[account(mut)]
    pub staker_destination: AccountInfo<'info>,

    /// The staker claiming rewards.
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}
