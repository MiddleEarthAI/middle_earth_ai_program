// battle.rs
use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;
use crate::events::*; // Make sure BattleResolved is defined in your events module
 // For validate_attack

/// Resolve a battle outcome.
/// This function subtracts `transfer_amount` from the loser and adds it to the winner.
/// It also enforces that the winner’s attack cooldown has passed.
pub fn resolve_battle(
    ctx: Context<ResolveBattle>,
    transfer_amount: u64,
) -> Result<()> {
    let authority = &ctx.accounts.authority;
    let game = &ctx.accounts.game;

    // Only the game authority can resolve battles.
    require!(authority.key() == game.authority, GameError::Unauthorized);

    let winner = &mut ctx.accounts.winner;
    let loser = &mut ctx.accounts.loser;

    let now = Clock::get()?.unix_timestamp;
    // Ensure the winner is off cooldown.
    winner.validate_attack(now)?;

    // Check that the loser has sufficient funds.
    require!(
        loser.token_balance >= transfer_amount,
        GameError::InsufficientFunds
    );

    // Update token balances.
    loser.token_balance = loser
        .token_balance
        .checked_sub(transfer_amount)
        .ok_or(GameError::TokenTransferError)?;
    winner.token_balance = winner
        .token_balance
        .checked_add(transfer_amount)
        .ok_or(GameError::TokenTransferError)?;

    // Update the winner's last_attack timestamp (starting the cooldown).
    winner.last_attack = now;

    emit!(BattleResolved {
        winner_id: winner.id,
        loser_id: loser.id,
        transfer_amount,
    });

    Ok(())
}

/// Same as above for alliance battles.
pub fn resolve_battle_agent_alliance(
    ctx: Context<ResolveBattle>,
    transfer_amount: u64,
) -> Result<()> {
    let authority = &ctx.accounts.authority;
    let game = &ctx.accounts.game;

    require!(authority.key() == game.authority, GameError::Unauthorized);

    let winner = &mut ctx.accounts.winner;
    let loser = &mut ctx.accounts.loser;

    let now = Clock::get()?.unix_timestamp;
    winner.validate_attack(now)?;

    require!(
        loser.token_balance >= transfer_amount,
        GameError::InsufficientFunds
    );

    loser.token_balance = loser
        .token_balance
        .checked_sub(transfer_amount)
        .ok_or(GameError::TokenTransferError)?;
    winner.token_balance = winner
        .token_balance
        .checked_add(transfer_amount)
        .ok_or(GameError::TokenTransferError)?;

    winner.last_attack = now;

    emit!(BattleResolved {
        winner_id: winner.id,
        loser_id: loser.id,
        transfer_amount,
    });

    Ok(())
}

/// Accounts context for resolving a battle.
#[derive(Accounts)]
pub struct ResolveBattle<'info> {
    #[account(mut, has_one = game)]
    pub winner: Account<'info, Agent>,

    #[account(mut, has_one = game)]
    pub loser: Account<'info, Agent>,

    pub game: Account<'info, Game>,

    #[account(mut)]
    pub authority: Signer<'info>,
}
