use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer, Token, TokenAccount};
use crate::state::{Agent, Game, StakeInfo, StakerStake};
use crate::error::GameError;
use crate::constants::*;
use anchor_lang::solana_program::program_pack::Pack;

pub const DAILY_REWARD_TOKENS: u64 = 500_000;
pub const ONE_HOUR: i64 = 3600;
pub const REWARD_CLAIM_COOLDOWN: i64 = 86400;

/// Update the total_stake_accounts vector in the Game account
fn add_stake_to_game(game: &mut Account<Game>, staker: Pubkey, amount: u64) -> Result<()> {
    if let Some(entry) = game
        .total_stake_accounts
        .iter_mut()
        .find(|x| x.staker == staker)
    {
        entry.total_stake = entry
            .total_stake
            .checked_add(amount)
            .ok_or(GameError::NotEnoughTokens)?;
    } else {
        game.total_stake_accounts.push(StakerStake {
            staker,
            total_stake: amount,
        });
    }
    Ok(())
}

fn remove_stake_from_game(game: &mut Account<Game>, staker: Pubkey, amount: u64) -> Result<()> {
    if let Some(entry) = game
        .total_stake_accounts
        .iter_mut()
        .find(|x| x.staker == staker)
    {
        entry.total_stake = entry
            .total_stake
            .checked_sub(amount)
            .ok_or(GameError::NotEnoughTokens)?;
    }
    Ok(())
}

/// --------------------------------------------
/// INITIALIZE STAKE (FIRST DEPOSIT)
/// --------------------------------------------
pub fn initialize_stake(ctx: Context<InitializeStake>, deposit_amount: u64) -> Result<()> {
    require!(deposit_amount > 0, GameError::InvalidAmount);

    let stake_info = &mut ctx.accounts.stake_info;
    // Mark as initialized
    stake_info.is_initialized = true;
    stake_info.agent = ctx.accounts.agent.key();
    stake_info.staker = ctx.accounts.authority.key();
    stake_info.last_reward_timestamp = 0;
    // If you have a bump in StakeInfo, either remove it or set it to 0 or any default:
    // stake_info.bump = 0;

    // Transfer tokens from staker -> agent vault
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token::Transfer {
            from: ctx.accounts.staker_source.to_account_info(),
            to: ctx.accounts.agent_vault.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, deposit_amount)?;

    // Read agent vault balance BEFORE deposit
    let data = ctx.accounts.agent_vault.data.borrow();
    let mut slice: &[u8] = &data;
    let vault_info = anchor_spl::token::TokenAccount::try_deserialize(&mut slice)?;
    let vault_balance_before = vault_info.amount;

    let total_shares = ctx.accounts.agent.total_shares; // agent.total_shares is u128
    // Calculate new shares to mint
    let shares_to_mint: u64 = if vault_balance_before == deposit_amount || total_shares == 0 {
        deposit_amount
    } else {
        deposit_amount
            .checked_mul(total_shares as u64)
            .ok_or(GameError::NotEnoughTokens)?
            .checked_div(vault_balance_before)
            .ok_or(GameError::NotEnoughTokens)?
    };

    // Update agent's total_shares (u128)
    ctx.accounts.agent.total_shares = ctx
        .accounts
        .agent
        .total_shares
        .checked_add((shares_to_mint as u128).try_into().unwrap())
        .ok_or(GameError::NotEnoughTokens)?;

    // Update stake_info
    stake_info.amount = deposit_amount;
    stake_info.shares = shares_to_mint;

    // Update global total stake
    add_stake_to_game(&mut ctx.accounts.game, ctx.accounts.authority.key(), deposit_amount)?;

    // Set cooldown
    let now = Clock::get()?.unix_timestamp;
    stake_info.cooldown_ends_at = now + ONE_HOUR;

    Ok(())
}

/// --------------------------------------------
/// STAKE TOKENS (Subsequent Deposits)
/// --------------------------------------------
pub fn stake_tokens(ctx: Context<StakeTokens>, deposit_amount: u64) -> Result<()> {
    require!(deposit_amount > 0, GameError::InvalidAmount);

    let stake_info = &mut ctx.accounts.stake_info;
    require!(stake_info.is_initialized, GameError::NotEnoughTokens);

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token::Transfer {
            from: ctx.accounts.staker_source.to_account_info(),
            to: ctx.accounts.agent_vault.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, deposit_amount)?;

    // Read vault balance
    let data = ctx.accounts.agent_vault.data.borrow();
    let mut slice: &[u8] = &data;
    let vault_info = anchor_spl::token::TokenAccount::try_deserialize(&mut slice)?;
    let vault_balance_before = vault_info.amount;

    let total_shares = ctx.accounts.agent.total_shares; // u128
    let shares_to_mint: u64 = if vault_balance_before == deposit_amount || total_shares == 0 {
        deposit_amount
    } else {
        deposit_amount
            .checked_mul(total_shares as u64)
            .ok_or(GameError::NotEnoughTokens)?
            .checked_div(vault_balance_before)
            .ok_or(GameError::NotEnoughTokens)?
    };

    // Add to agent total_shares
    ctx.accounts.agent.total_shares = ctx
        .accounts
        .agent
        .total_shares
        .checked_add((shares_to_mint as u128).try_into().unwrap())
        .ok_or(GameError::NotEnoughTokens)?;

    // Update stake_info
    stake_info.amount = stake_info
        .amount
        .checked_add(deposit_amount)
        .ok_or(GameError::NotEnoughTokens)?;
    stake_info.shares = stake_info
        .shares
        .checked_add(shares_to_mint)
        .ok_or(GameError::NotEnoughTokens)?;

    add_stake_to_game(&mut ctx.accounts.game, ctx.accounts.authority.key(), deposit_amount)?;

    let now = Clock::get()?.unix_timestamp;
    stake_info.cooldown_ends_at = now + ONE_HOUR;

    Ok(())
}

/// --------------------------------------------
/// UNSTAKE TOKENS
/// --------------------------------------------
pub fn unstake_tokens(ctx: Context<UnstakeTokens>, shares_to_redeem: u64) -> Result<()> {
    let stake_info = &mut ctx.accounts.stake_info;

    require!(stake_info.is_initialized, GameError::NotEnoughTokens);
    require!(shares_to_redeem > 0, GameError::InvalidAmount);

    require!(
        u128::from(stake_info.shares) >= u128::from(shares_to_redeem),
        GameError::NotEnoughTokens
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= stake_info.cooldown_ends_at,
        GameError::CooldownNotOver
    );

    let data = ctx.accounts.agent_vault.data.borrow();
    let mut slice: &[u8] = &data;
    let vault_info = anchor_spl::token::TokenAccount::try_deserialize(&mut slice)?;
    let vault_balance = vault_info.amount; // u64
    let total_shares = ctx.accounts.agent.total_shares; // u128

    // Proportional withdrawal = (shares_to_redeem / total_shares) * vault_balance
    let withdraw_amount = u128::from(shares_to_redeem)
        .checked_mul(u128::from(vault_balance))
        .ok_or(GameError::NotEnoughTokens)?
        .checked_div(total_shares.into())
        .ok_or(GameError::NotEnoughTokens)?;

    // Decrease agent total_shares
    ctx.accounts.agent.total_shares = ctx
        .accounts
        .agent
        .total_shares
        .checked_sub(u64::from(shares_to_redeem))
        .ok_or(GameError::NotEnoughTokens)?;

    // Update stake_info
    stake_info.amount = stake_info
        .amount
        .checked_sub(withdraw_amount as u64)
        .ok_or(GameError::NotEnoughTokens)?;
    stake_info.shares = stake_info
        .shares
        .checked_sub(shares_to_redeem)
        .ok_or(GameError::NotEnoughTokens)?;

    // Remove from global total stake
    remove_stake_from_game(
        &mut ctx.accounts.game,
        ctx.accounts.authority.key(),
        withdraw_amount as u64,
    )?;

    // Transfer tokens from the vault to the staker
    let cpi_accounts = Transfer {
        from: ctx.accounts.agent_vault.to_account_info(),
        to: ctx.accounts.staker_destination.to_account_info(),
        authority: ctx.accounts.agent_authority.clone(),
    };
    let agent_key = ctx.accounts.agent.key();
    let seeds = &[
        b"agent_vault",
        agent_key.as_ref(),
        &[ctx.accounts.agent.vault_bump],
    ];
    let signer = &[&seeds[..]];
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, withdraw_amount as u64)?;

    Ok(())
}

/// --------------------------------------------
/// CLAIM REWARDS
/// --------------------------------------------
pub fn claim_staking_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let stake_info = &mut ctx.accounts.stake_info;
    require!(stake_info.is_initialized, GameError::NotEnoughTokens);

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= stake_info.cooldown_ends_at,
        GameError::CooldownNotOver
    );

    require!(
        now >= stake_info.last_reward_timestamp + REWARD_CLAIM_COOLDOWN,
        GameError::ClaimCooldown
    );

    let mint_data = ctx.accounts.mint.data.borrow();
    let mut mint_slice: &[u8] = &mint_data;
    let mint_state = spl_token::state::Mint::unpack(&mut mint_slice)?;
    let total_supply = mint_state.supply;
    if total_supply == 0 {
        return Ok(());
    }

    let staker_data = {
        let data = ctx.accounts.staker_destination.data.borrow();
        let mut slice: &[u8] = &data;
        anchor_spl::token::TokenAccount::try_deserialize(&mut slice)?.amount
    };
    if staker_data == 0 {
        return Ok(());
    }

    // fraction = staker_balance / total_supply
    let fraction = (staker_data as f64) / (total_supply as f64);
    let user_reward_float = fraction * (DAILY_REWARD_TOKENS as f64);
    let user_reward = user_reward_float.floor() as u64;
    if user_reward == 0 {
        return Ok(());
    }

    let cpi_accounts = Transfer {
        from: ctx.accounts.rewards_vault.to_account_info(),
        to: ctx.accounts.staker_destination.to_account_info(),
        authority: ctx.accounts.rewards_authority.clone(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, user_reward)?;

    stake_info.last_reward_timestamp = now;

    Ok(())
}

// -----------------------------------
// ACCOUNTS STRUCTS
// -----------------------------------
#[derive(Accounts)]
pub struct InitializeStake<'info> {
    /// The agent this stake will be associated with
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub game: Account<'info, Game>,

    /// Create the stake_info account (first deposit)
    #[account(
        init,
        payer = authority,
        seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()],
        bump,
        space = 8 + StakeInfo::INIT_SPACE
    )]
    pub stake_info: Account<'info, StakeInfo>,

    /// The staker's token account (source)
    #[account(mut)]
    pub staker_source: AccountInfo<'info>,

    /// The agent's vault (destination for tokens)
    #[account(mut)]
    pub agent_vault: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct StakeTokens<'info> {
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub game: Account<'info, Game>,

    /// Must be initialized
    #[account(
        mut,
        seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()],
        bump // no reference to stake_info.bump needed if we don't store it
    )]
    pub stake_info: Account<'info, StakeInfo>,

    #[account(mut)]
    pub staker_source: AccountInfo<'info>,
    #[account(mut)]
    pub agent_vault: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UnstakeTokens<'info> {
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()], bump)]
    pub stake_info: Account<'info, StakeInfo>,

    #[account(mut)]
    pub agent_vault: AccountInfo<'info>,

    #[account(mut)]
    pub agent_authority: AccountInfo<'info>,

    #[account(mut)]
    pub staker_destination: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()], bump)]
    pub stake_info: Account<'info, StakeInfo>,

    /// The mint from which we read the total supply.
    /// CHECK: We'll manually deserialize.
    pub mint: UncheckedAccount<'info>,

    #[account(mut)]
    pub rewards_vault: AccountInfo<'info>,

    /// The authority over the rewards vault
    #[account(mut)]
    pub rewards_authority: AccountInfo<'info>,

    #[account(mut)]
    pub staker_destination: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}
