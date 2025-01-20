use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer, Token, Mint, TokenAccount};
use crate::state::{Agent, Game, StakeInfo, StakerStake};
use crate::error::GameError;
use crate::constants::*;
use anchor_lang::solana_program::program_pack::Pack;

pub const DAILY_REWARD_TOKENS: u64 = 500_000;  // example daily distribution
pub const ONE_HOUR: i64 = 3600;                // 1 hour in seconds

/// --------------------------------------------
/// HELPER: Update the total_stake_accounts vector
/// --------------------------------------------
fn add_stake_to_game(game: &mut Account<Game>, staker: Pubkey, amount: u64) -> Result<()> {
    // Find the staker's entry if it exists
    if let Some(entry) = game
        .total_stake_accounts
        .iter_mut()
        .find(|x| x.staker == staker)
    {
        // update if found
        entry.total_stake = entry
            .total_stake
            .checked_add(amount)
            .ok_or(GameError::NotEnoughTokens)?;
    } else {
        // otherwise push a new entry
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
        // Reduce the total stake, ensuring it won't go negative
        entry.total_stake = entry
            .total_stake
            .checked_sub(amount)
            .ok_or(GameError::NotEnoughTokens)?;
    }
    // If you want, you could remove the entry if total_stake == 0
    Ok(())
}

/// --------------------------------------------
/// STAKE
/// --------------------------------------------
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

    // 2) Read the current vault balance
    let vault_balance: u64 = {
        let data = ctx.accounts.agent_vault.data.borrow();
        let mut slice: &[u8] = &data;
        anchor_spl::token::TokenAccount::try_deserialize(&mut slice)?.amount
    };
    let total_shares = ctx.accounts.agent.total_shares; // u128

    // 3) Calculate shares to mint
    let shares_to_mint: u64 = if vault_balance == deposit_amount || total_shares == 0 {
        deposit_amount
    } else {
        let prev_balance = vault_balance
            .checked_sub(deposit_amount)
            .ok_or_else(|| error!(GameError::NotEnoughTokens))?;
        deposit_amount
            .checked_mul(total_shares.try_into().unwrap())
            .ok_or_else(|| error!(GameError::NotEnoughTokens))?
            .checked_div(prev_balance.into())
            .ok_or_else(|| error!(GameError::NotEnoughTokens))?
    };

    // 4) Update the agent's total shares
    ctx.accounts.agent.total_shares = ctx
        .accounts
        .agent
        .total_shares
        .checked_add(shares_to_mint.into())
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    // 5) Update the staker's record
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

    // 6) Update global total stake
    add_stake_to_game(
        &mut ctx.accounts.game,
        ctx.accounts.authority.key(),
        deposit_amount,
    )?;

    // 7) Set the 1-hour cooldown for this staker
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.stake_info.cooldown_ends_at = now + ONE_HOUR;

    Ok(())
}

/// --------------------------------------------
/// UNSTAKE
/// --------------------------------------------
pub fn unstake_tokens(ctx: Context<UnstakeTokens>, shares_to_redeem: u64) -> Result<()> {
    // 1) Ensure the staker has enough shares
    require!(
        u128::from(ctx.accounts.stake_info.shares) >= u128::from(shares_to_redeem),
        GameError::NotEnoughTokens
    );

    // 2) Check the 1-hour cooldown from last stake
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ctx.accounts.stake_info.cooldown_ends_at,
        GameError::CooldownNotOver
    );

    // 3) Read the vault balance
    let vault_balance: u64 = {
        let data = ctx.accounts.agent_vault.data.borrow();
        let mut slice: &[u8] = &data;
        anchor_spl::token::TokenAccount::try_deserialize(&mut slice)?.amount
    };
    let vault_balance_u128 = u128::from(vault_balance);
    let total_shares = ctx.accounts.agent.total_shares;

    // 4) Proportional withdrawal
    let withdraw_amount = u128::from(shares_to_redeem)
        .checked_mul(vault_balance_u128)
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?
        .checked_div(total_shares.into())
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    // 5) Update the agent's total shares
    ctx.accounts.agent.total_shares = ctx
        .accounts
        .agent
        .total_shares
        .checked_sub(u64::from(shares_to_redeem))
        .ok_or_else(|| error!(GameError::NotEnoughTokens))?;

    // 6) Update the staker's record
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

    // 7) Decrease global total stake
    remove_stake_from_game(
        &mut ctx.accounts.game,
        ctx.accounts.authority.key(),
        withdraw_amount.try_into().unwrap(),
    )?;

    // 8) Transfer tokens from the vault to the staker's destination
    let cpi_accounts = Transfer {
        from: ctx.accounts.agent_vault.clone(),
        to: ctx.accounts.staker_destination.clone(),
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
    token::transfer(cpi_ctx, withdraw_amount.try_into().unwrap())?;

    Ok(())
}

/// --------------------------------------------
/// CLAIM REWARDS
/// --------------------------------------------
pub fn claim_staking_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // 1) Check 1-hour cooldown from last stake
    require!(
        now >= ctx.accounts.stake_info.cooldown_ends_at,
        GameError::CooldownNotOver
    );

    // 2) Check existing 24-hour reward cooldown
    require!(
        now >= ctx.accounts.stake_info.last_reward_timestamp + REWARD_CLAIM_COOLDOWN,
        GameError::ClaimCooldown
    );

    // 3) Read total supply from the Mint
    let mint_data = ctx.accounts.mint.data.borrow();
    let mut mint_slice: &[u8] = &mint_data;
    let mint_state = spl_token::state::Mint::unpack(&mut mint_slice)?;
    let total_supply = mint_state.supply;
    if total_supply == 0 {
        return Ok(());
    }

    // 4) Read the staker’s token account balance
    let staker_data = {
        let data = ctx.accounts.staker_destination.data.borrow();
        let mut slice: &[u8] = &data;
        anchor_spl::token::TokenAccount::try_deserialize(&mut slice)?.amount
    };
    if staker_data == 0 {
        return Ok(());
    }

    // 5) fraction = staker_balance / total_supply
    let fraction = (staker_data as f64) / (total_supply as f64);

    // 6) user_reward = fraction * DAILY_REWARD_TOKENS
    let user_reward_float = fraction * (DAILY_REWARD_TOKENS as f64);
    let user_reward = user_reward_float.floor() as u64;
    if user_reward == 0 {
        return Ok(());
    }

    // 7) Transfer from rewards_vault -> staker_destination
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

    // 8) Update last_reward_timestamp
    ctx.accounts.stake_info.last_reward_timestamp = now;

    Ok(())
}

// -----------------------------------
// ACCOUNTS structs
// -----------------------------------
#[derive(Accounts)]
pub struct StakeTokens<'info> {
    /// The agent state.
    #[account(mut, has_one = game, has_one = authority)]
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

    #[account(mut, constraint = *staker_source.owner == *authority.key)]
    /// CHECK: This is a token account owned by the staker.
    pub staker_source: AccountInfo<'info>,

    #[account(mut, constraint = *agent_vault.owner == anchor_spl::token::ID)]
    /// CHECK: This token account is owned by the SPL Token program.
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

    #[account(mut)]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()], bump)]
    pub stake_info: Account<'info, StakeInfo>,

    #[account(mut, constraint = *agent_vault.owner == anchor_spl::token::ID)]
    /// CHECK: This is a token account owned by the SPL Token program.
    pub agent_vault: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: This is the PDA that signs on behalf of the vault.
    pub agent_authority: AccountInfo<'info>,

    #[account(mut, constraint = *staker_destination.owner == anchor_spl::token::ID)]
    /// CHECK: Staker's token account (destination).
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

    #[account(
        mut,
        seeds = [b"stake", agent.key().as_ref(), authority.key().as_ref()],
        bump
    )]
    pub stake_info: Account<'info, StakeInfo>,

    /// The mint from which we read the total supply.
    /// CHECK: We'll manually deserialize.
    pub mint: UncheckedAccount<'info>,

    /// The rewards vault from which reward tokens will be transferred.
    /// CHECK: Owned by the SPL Token program.
    #[account(mut)]
    pub rewards_vault: AccountInfo<'info>,

    /// The authority over the rewards vault (to sign for transfers).
    /// CHECK: Must match your logic for the vault.
    #[account(mut)]
    pub rewards_authority: AccountInfo<'info>,

    /// The staker's token account to receive the rewards.
    /// CHECK: Owned by the SPL Token program.
    #[account(mut)]
    pub staker_destination: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}
