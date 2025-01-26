use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer, Token, TokenAccount};
use crate::state::{Agent, Game, StakeInfo, StakerStake};
use crate::error::GameError;

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
            authority: ctx.accounts.authority.to_account_info(), // staker signs
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

    let total_shares = ctx.accounts.agent.total_shares; 

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
        authority: ctx.accounts.authority.to_account_info(), // The staker or agent is directly signing
    };

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );

    token::transfer(cpi_ctx, withdraw_amount as u64)?;

    // Debug Log after Transfer
    msg!("UnstakeTokens: Transferred {} tokens from agent_vault to staker_destination", withdraw_amount);

    Ok(())
}

/// --------------------------------------------
/// CLAIM REWARDS
/// --------------------------------------------

// total_rewards = (amount_staked / total_token_in_supply) * (time_elapsed / 86400) * daily_reward_tokens
pub fn claim_staking_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let stake_info = &mut ctx.accounts.stake_info;
    let REWARD_RATE_PER_SECOND: u64 = DAILY_REWARD_TOKENS / 86400; 
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
    let time_elapsed = now - stake_info.last_reward_timestamp;

    // Calculate the user's share proportion
    let stake_shares = stake_info.shares as f64;
    let total_shares = ctx.accounts.agent.total_shares as f64;
    let share_proportion = stake_shares / total_shares;

    // Calculate the rewards based on time elapsed and share proportion
    let user_reward_float =
        (time_elapsed as f64) * (REWARD_RATE_PER_SECOND as f64) * share_proportion;
    let user_reward = user_reward_float.floor() as u64;

    // Borrow the rewards vault once
    let _rewards_balance = {
        let rewards_data = ctx.accounts.rewards_vault.try_borrow_data()?;
        let rewards_account = TokenAccount::try_deserialize(&mut &rewards_data[..])?;
        rewards_account.amount
    };

    // Transfer rewards to the staker
    let cpi_accounts = Transfer {
        from: ctx.accounts.rewards_vault.to_account_info(),
        to: ctx.accounts.staker_destination.to_account_info(),
        authority: ctx.accounts.rewards_authority.clone(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, user_reward)?;

    // Update stake_info
    stake_info.last_reward_timestamp = now;

    Ok(())
}


pub fn update_daily_rewards(ctx: Context<UpdateDailyRewards>, new_daily_reward: u64) -> Result<()> {
    // Only game authority can call this function
    let game = &mut ctx.accounts.game;
    require!(ctx.accounts.authority.key() == game.authority, GameError::Unauthorized);

    // Update the daily reward
    game.daily_reward_tokens = new_daily_reward;

    // Emit an event (optional)
    emit!(DailyRewardUpdated {
        new_daily_reward
    });

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

    /// CHECK: This is the staker's token account. 
    /// We verify it's owned by the SPL token program externally.
    #[account(mut)]
    pub staker_source: AccountInfo<'info>,

    /// CHECK: This is the agent's vault token account. 
    /// We verify it's owned by the SPL token program externally.
    #[account(mut)]
    pub agent_vault: AccountInfo<'info>,

    // The staker who signs the transaction
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

    #[account(
        mut,
        seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()],
        bump
    )]
    pub stake_info: Account<'info, StakeInfo>,

    /// CHECK: This is the staker's token account. 
    /// We verify it's owned by the SPL token program externally.
    #[account(mut)]
    pub staker_source: AccountInfo<'info>,

    /// CHECK: This is the agent's vault token account. 
    /// We verify it's owned by the SPL token program externally.
    #[account(mut)]
    pub agent_vault: AccountInfo<'info>,

    // The staker who signs the transaction
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

    /// CHECK: The agent's vault token account. 
    #[account(mut)]
    pub agent_vault: AccountInfo<'info>,

    /// CHECK: The staker's token account (destination).
    #[account(mut)]
    pub staker_destination: AccountInfo<'info>,

    // The wallet (could be the agent or staker) that has authority over agent_vault
    // For partial or full unstaking. This is the direct signer, like in battle code.
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

    /// CHECK: We'll manually deserialize the mint if needed
    #[account()]
    pub mint: AccountInfo<'info>,

    /// CHECK: The rewards vault from which reward tokens will be transferred.
    #[account(mut)]
    pub rewards_vault: AccountInfo<'info>,

    /// CHECK: The authority over the rewards vault (signer).
    // Must sign if we actually needed a separate key. 
    // Or if the same user who owns the vault can sign, they'd pass the same signer here.
    #[account(mut)]
    pub rewards_authority: AccountInfo<'info>,

    /// CHECK: The staker's token account to receive rewards.
    #[account(mut)]
    pub staker_destination: AccountInfo<'info>,

    // The user with authority to claim
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}



#[derive(Accounts)]
pub struct UpdateDailyRewards<'info> {
    #[account(mut, has_one = authority)]
    pub game: Account<'info, Game>,

    /// The authority to update daily rewards (game authority)
    pub authority: Signer<'info>,
}

/// --------------------------------------------
/// EVENTS (Optional)
/// --------------------------------------------
#[event]
pub struct DailyRewardUpdated {
    pub new_daily_reward: u64,
}
