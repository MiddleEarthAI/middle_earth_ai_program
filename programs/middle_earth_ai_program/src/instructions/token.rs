use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer, Token, TokenAccount};
use crate::state::{Agent, Game, StakeInfo, StakerStake};
use crate::error::GameError;

pub const DAILY_REWARD_TOKENS: u64 = 500_000;
pub const ONE_HOUR: i64 = 3600;
pub const TWO_HOURS: i64 = 7200; // 2 hours in seconds
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
    stake_info.is_initialized = true;
    stake_info.agent = ctx.accounts.agent.key();
    stake_info.staker = ctx.accounts.authority.key();
    stake_info.last_reward_timestamp = 0;

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
    let vault_info = TokenAccount::try_deserialize(&mut slice)?;
    let vault_balance_before = vault_info.amount;

    let total_shares = ctx.accounts.agent.total_shares; // u128
    let shares_to_mint: u128 = if vault_balance_before == deposit_amount || total_shares == 0 {
        deposit_amount as u128
    } else {
        (deposit_amount as u128)
            .checked_mul(total_shares)
            .ok_or(GameError::NotEnoughTokens)?
            .checked_div(vault_balance_before as u128)
            .ok_or(GameError::NotEnoughTokens)?
    };

    // Update agent's total_shares
    ctx.accounts.agent.total_shares = ctx
        .accounts
        .agent
        .total_shares
        .checked_add(shares_to_mint)
        .ok_or(GameError::NotEnoughTokens)?;
    ctx.accounts.agent.staked_balance = ctx
        .accounts
        .agent
        .staked_balance
        .checked_add(deposit_amount as u128)
        .ok_or(GameError::NotEnoughTokens)?;
    // Update stake_info
    stake_info.amount = deposit_amount;
    stake_info.shares = shares_to_mint;

    // Update global total stake
    add_stake_to_game(&mut ctx.accounts.game, ctx.accounts.authority.key(), deposit_amount)?;

    // Set cooldown to 1 hour initially
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

    // Transfer tokens from staker -> agent vault
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token::Transfer {
            from: ctx.accounts.staker_source.to_account_info(),
            to: ctx.accounts.agent_vault.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(), // staker signs
        },
    );
    token::transfer(cpi_ctx, deposit_amount)?;

    // Read vault balance
    let data = ctx.accounts.agent_vault.data.borrow();
    let mut slice: &[u8] = &data;
    let vault_info = TokenAccount::try_deserialize(&mut slice)?;
    let vault_balance_before = vault_info.amount;

    let total_shares = ctx.accounts.agent.total_shares; // u128
    let shares_to_mint: u128 = if vault_balance_before == deposit_amount || total_shares == 0 {
        deposit_amount as u128
    } else {
        (deposit_amount as u128)
            .checked_mul(total_shares)
            .ok_or(GameError::NotEnoughTokens)?
            .checked_div(vault_balance_before as u128)
            .ok_or(GameError::NotEnoughTokens)?
    };

    // Add to agent total_shares
    ctx.accounts.agent.total_shares = ctx
        .accounts
        .agent
        .total_shares
        .checked_add(shares_to_mint)
        .ok_or(GameError::NotEnoughTokens)?;
    ctx.accounts.agent.staked_balance = ctx
        .accounts
        .agent
        .staked_balance
        .checked_add(deposit_amount as u128)
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
        stake_info.shares >= shares_to_redeem as u128,
        GameError::NotEnoughTokens
    );
    require_keys_eq!(
        stake_info.staker,
        ctx.accounts.authority.key(),
        GameError::Unauthorized
    );
    let now = Clock::get()?.unix_timestamp;
    // require!(
    //     now >= stake_info.cooldown_ends_at,
    //     GameError::CooldownNotOver
    // );

    // Borrow the vault data once
    let vault_balance = {
        let vault_data = ctx.accounts.agent_vault.try_borrow_data()?;
        let vault_account = TokenAccount::try_deserialize(&mut &vault_data[..])?;
        vault_account.amount
    };

    let total_shares = ctx.accounts.agent.total_shares; // u128

    // Calculate the withdraw amount proportionally
    let withdraw_amount = u128::from(shares_to_redeem)
        .checked_mul(u128::from(vault_balance))
        .ok_or(GameError::NotEnoughTokens)?
        .checked_div(total_shares)
        .ok_or(GameError::NotEnoughTokens)?;

    // Update agent's total_shares
    ctx.accounts.agent.total_shares = ctx
        .accounts
        .agent
        .total_shares
        .checked_sub(u128::from(shares_to_redeem))
        .ok_or(GameError::NotEnoughTokens)?;
    ctx.accounts.agent.staked_balance = ctx
        .accounts
        .agent
        .staked_balance
        .checked_sub(withdraw_amount)
        .ok_or(GameError::NotEnoughTokens)?;
    // Update stake_info
    stake_info.amount = stake_info
        .amount
        .checked_sub(withdraw_amount as u64)
        .ok_or(GameError::NotEnoughTokens)?;
    stake_info.shares = stake_info
        .shares
        .checked_sub(shares_to_redeem as u128)
        .ok_or(GameError::NotEnoughTokens)?;

    // Update global total stake
    remove_stake_from_game(
        &mut ctx.accounts.game,
        ctx.accounts.authority.key(),
        withdraw_amount as u64,
    )?;

    // Transfer tokens from the vault to the staker
    let cpi_accounts = Transfer {
        from: ctx.accounts.agent_vault.to_account_info(),
        to: ctx.accounts.staker_destination.to_account_info(),
        authority: ctx.accounts.game_authority.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, withdraw_amount as u64)?;

    msg!("UnstakeTokens: Transferred {} tokens from agent_vault to staker_destination", withdraw_amount);

    Ok(())
}


/// --------------------------------------------
/// CLAIM REWARDS
/// --------------------------------------------
pub fn claim_staking_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let stake_info = &mut ctx.accounts.stake_info;
    let REWARD_RATE_PER_SECOND: u64 = DAILY_REWARD_TOKENS / 86400;

    // Ensure the stake is initialized
    require!(stake_info.is_initialized, GameError::NotEnoughTokens);

    // Verify the staker is authorized
    require_keys_eq!(
        stake_info.staker,
        ctx.accounts.authority.key(),
        GameError::Unauthorized
    );

    let now = Clock::get()?.unix_timestamp;

    // // Uncomment and adjust cooldown logic as needed
    // require!(
    //     now >= stake_info.cooldown_ends_at,
    //     GameError::CooldownNotOver
    // );

    // require!(
    //     now >= stake_info.last_reward_timestamp + REWARD_CLAIM_COOLDOWN,
    //     GameError::ClaimCooldown
    // );

    let time_elapsed = now - stake_info.last_reward_timestamp + 1;

    // Calculate the user's share proportion
    let stake_shares = stake_info.shares as f64;
    let total_shares = ctx.accounts.agent.total_shares as f64;
    let share_proportion = stake_shares / total_shares;

    // Calculate the rewards
    let user_reward_float = (time_elapsed as f64) * (REWARD_RATE_PER_SECOND as f64) * share_proportion;
    let user_reward = user_reward_float.floor() as u64;

    // Limit the scope of the borrow to prevent double borrowing
    {
        // Manual deserialization within its own block
        let rewards_data = ctx.accounts.rewards_vault.try_borrow_data()?;
        let mut rewards_slice: &[u8] = &rewards_data;
        let rewards_vault_account = TokenAccount::try_deserialize(&mut rewards_slice)?;
        require!(
            rewards_vault_account.amount >= user_reward,
            GameError::NotEnoughTokens
        );
    } // Borrow is dropped here

    // Transfer rewards - approved by rewards_authority
    let cpi_accounts = Transfer {
        from: ctx.accounts.rewards_vault.to_account_info(),
        to: ctx.accounts.staker_destination.to_account_info(),
        authority: ctx.accounts.rewards_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, user_reward)?;

    // Update the last reward timestamp
    stake_info.last_reward_timestamp = now;


    Ok(())
}


/// --------------------------------------------
/// UPDATE DAILY REWARDS
/// --------------------------------------------
pub fn update_daily_rewards(ctx: Context<UpdateDailyRewards>, new_daily_reward: u64) -> Result<()> {
    let game = &mut ctx.accounts.game;
    require!(ctx.accounts.authority.key() == game.authority, GameError::Unauthorized);

    game.daily_reward_tokens = new_daily_reward;

    emit!(DailyRewardUpdated {
        new_daily_reward
    });

    Ok(())
}

// -----------------------------------
// ACCOUNTS STRUCTS
// -----------------------------------

#[derive(Accounts)]
#[instruction(game_id: u32, bump: u8)]
pub struct InitializeStake<'info> {
    #[account(mut, has_one = game)]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub game: Account<'info, Game>,

    #[account(
        init,
        payer = authority,
        seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()],
        bump,
        space = 8 + StakeInfo::INIT_SPACE
    )]
    pub stake_info: Account<'info, StakeInfo>,

    /// CHECK: Staker's token account
    #[account(mut)]
    pub staker_source: AccountInfo<'info>,

    /// CHECK: Agent's vault token account
    #[account(mut)]
    pub agent_vault: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>, // Staker

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct StakeTokens<'info> {
    #[account(mut, has_one = game)]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()], bump)]
    pub stake_info: Account<'info, StakeInfo>,

    /// CHECK: Staker's token account
    #[account(mut)]
    pub staker_source: AccountInfo<'info>,

    /// CHECK: Agent's vault token account
    #[account(mut)]
    pub agent_vault: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>, // Staker

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UnstakeTokens<'info> {
    #[account(mut, has_one = game)]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub game: Account<'info, Game>,

    #[account(
        mut,
        seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()],
        bump
    )]
    pub stake_info: Account<'info, StakeInfo>,

    /// CHECK: Agent's vault token account
    #[account(mut)]
    pub agent_vault: AccountInfo<'info>,

    /// CHECK: The staker's token account (destination).
    #[account(mut)]
    pub staker_destination: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>, // The staker

    /// The game authority, who owns the vault
    #[account(mut)]
    pub game_authority: Signer<'info>, // Correctly defined

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

// #[derive(Accounts)]
// pub struct InitiateCooldown<'info> {
//     #[account(mut, has_one = game)]
//     pub agent: Account<'info, Agent>,

//     #[account(mut)]
//     pub game: Account<'info, Game>,

//     #[account(
//         mut,
//         seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()],
//         bump
//     )]
//     pub stake_info: Account<'info, StakeInfo>,

//     #[account(mut)]
//     pub authority: Signer<'info>, // The user who initiates cooldown

//     pub system_program: Program<'info, System>,
// }

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut, has_one = game)]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub game: Account<'info, Game>,

    #[account(
        mut,
        seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()],
        bump
    )]
    pub stake_info: Account<'info, StakeInfo>,

    /// CHECK: We can manually deserialize mint if needed
    #[account()]
    pub mint: AccountInfo<'info>,

    /// CHECK: Rewards vault
    #[account(mut)]
    pub rewards_vault: AccountInfo<'info>,

    /// CHECK: The staker's token account for rewards
    #[account(mut)]
    pub staker_destination: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>, // The staker

    /// CHECK: Rewards authority approves the transfer from rewards_vault
    /// CHECK: Rewards authority is a trusted signer who controls the rewards_vault
    #[account(mut, signer)]
    pub rewards_authority: AccountInfo<'info>, // Correctly marked as signer with documentation

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateDailyRewards<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,

    pub authority: Signer<'info>,
}

/// Optional events
#[event]
pub struct DailyRewardUpdated {
    pub new_daily_reward: u64,
}

#[event]
pub struct CooldownInitiated {
    pub stake_info: Pubkey,
    pub cooldown_ends_at: i64,
}