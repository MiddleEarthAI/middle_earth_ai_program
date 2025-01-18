use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;
use crate::events::*; // Ensure BattleResolved event is defined

/// Resolve a battle outcome **without any token transfers**.
/// Instead, it only updates the battle cooldown timer for each agent involved.
/// If an agent is in an alliance, its partner’s cooldown is updated as well.
/// 
/// Access control: Only the game authority (stored in the Game account) may resolve a battle.
pub fn resolve_battle(
    ctx: Context<ResolveBattle>,
    transfer_amount: u64, 
) -> Result<()> {
    let authority = &ctx.accounts.authority;
    let game = &ctx.accounts.game;

    // Enforce access control.
    require!(authority.key() == game.authority, GameError::Unauthorized);

    // Get mutable references to the winner and loser.
    let winner = &mut ctx.accounts.winner;
    let loser = &mut ctx.accounts.loser;
    let now = Clock::get()?.unix_timestamp;

    // Validate that the winner’s attack cooldown has expired.
    winner.validate_attack(now)?;

    // Update battle cooldown timer for the winner.
    winner.last_attack = now;
    // If the winner is allied, update its partner’s cooldown as well.
    if winner.alliance_with.is_some() {
        let winner_partner = &mut ctx.accounts.winner_partner;
        winner_partner.last_attack = now;
    }

    // Update the loser’s cooldown.
    loser.last_attack = now;
    // If the loser is allied, update its partner’s cooldown as well.
    if loser.alliance_with.is_some() {
        let loser_partner = &mut ctx.accounts.loser_partner;
        loser_partner.last_attack = now;
    }

    // Emit an event for record keeping.
    emit!(BattleResolved {
        winner_id: winner.id,
        loser_id: loser.id,
        transfer_amount, // This is only logged for simulation purposes.
    });

    Ok(())
}

/// Accounts context for resolving a battle with alliance support (no token transfers).
#[derive(Accounts)]
pub struct ResolveBattle<'info> {
    /// Winner agent state.
    #[account(mut, has_one = game)]
    pub winner: Account<'info, Agent>,
    /// Winner’s alliance partner state.
    #[account(mut)]
    pub winner_partner: Account<'info, Agent>,

    /// Loser agent state.
    #[account(mut, has_one = game)]
    pub loser: Account<'info, Agent>,
    /// Loser’s alliance partner state.
    #[account(mut)]
    pub loser_partner: Account<'info, Agent>,

    /// The game state.
    pub game: Account<'info, Game>,

    /// The authority allowed to resolve battles.
    #[account(mut)]
    pub authority: Signer<'info>,
}

/// Accounts context for resolving a simple (non‐alliance) battle (no transfers).
#[derive(Accounts)]
pub struct ResolveBattleSimple<'info> {
    /// Winner agent state.
    #[account(mut, has_one = game)]
    pub winner: Account<'info, Agent>,

    /// Loser agent state.
    #[account(mut, has_one = game)]
    pub loser: Account<'info, Agent>,

    /// The game state.
    pub game: Account<'info, Game>,

    /// The authority allowed to resolve battles.
    #[account(mut)]
    pub authority: Signer<'info>,
}

/// Resolve a simple battle (no alliance) without transferring tokens by updating battle cooldown timers.
/// Updates the winner’s (and loser’s) attack cooldown timer.
pub fn resolve_battle_simple(
    ctx: Context<ResolveBattleSimple>,
    transfer_amount: u64,
) -> Result<()> {
    let authority = &ctx.accounts.authority;
    let game = &ctx.accounts.game;
    require!(authority.key() == game.authority, GameError::Unauthorized);

    let winner = &mut ctx.accounts.winner;
    let loser = &mut ctx.accounts.loser;
    let now = Clock::get()?.unix_timestamp;

    winner.validate_attack(now)?;
    // Update cooldowns.
    winner.last_attack = now;
    loser.last_attack = now;

    emit!(BattleResolved {
        winner_id: winner.id,
        loser_id: loser.id,
        transfer_amount,
    });
    Ok(())
}
