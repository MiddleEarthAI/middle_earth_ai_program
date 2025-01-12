use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;
use crate::events::*; // Ensure BattleResolved event is defined in your events module.

/// Called by the owner address (e.g., Game authority) after offchain resolution 
/// has determined the winner, loser, and transfer_amount.
/// 
/// This function subtracts `transfer_amount` from the loser's token balance
/// and adds it to the winner's token balance.
pub fn resolve_battle(
    ctx: Context<ResolveBattle>,
    transfer_amount: u64,
) -> Result<()> {
    let authority = &ctx.accounts.authority;
    let game = &ctx.accounts.game;

    // Access control: Only the game owner (or designated authority) can resolve a battle.
    require!(authority.key() == game.authority, GameError::Unauthorized);

    let winner = &mut ctx.accounts.winner;
    let loser = &mut ctx.accounts.loser;

    // Check that the loser has sufficient funds.
    require!(
        loser.token_balance >= transfer_amount,
        GameError::InsufficientFunds
    );

    // Update balances.
    loser.token_balance = loser
        .token_balance
        .checked_sub(transfer_amount)
        .ok_or(GameError::TokenTransferError)?;
    winner.token_balance = winner
        .token_balance
        .checked_add(transfer_amount)
        .ok_or(GameError::TokenTransferError)?;

    // Optionally, update battle-related timestamps or state fields
    // (for example, you might want to clear current_battle_start, etc.)

    // Emit an event to signal the battle resolution.
    emit!(BattleResolved {
        winner_id: winner.id,
        loser_id: loser.id,
        transfer_amount,
    });

    Ok(())
}

/// Context for resolving a battle outcome.
#[derive(Accounts)]
pub struct ResolveBattle<'info> {
    // The winner of the battle.
    #[account(
        mut,
        has_one = game, 
        // The winner's authority relation can be checked here if necessary;
        // however, in this case, we rely on the game's authority.
    )]
    pub winner: Account<'info, Agent>,

    // The loser of the battle.
    #[account(mut, has_one = game)]
    pub loser: Account<'info, Agent>,

    // The global game state; its authority field is used for access control.
    pub game: Account<'info, Game>,

    // The authority (owner) calling the function.
    #[account(mut)]
    pub authority: Signer<'info>,
}
