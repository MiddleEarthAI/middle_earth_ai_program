use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;
use crate::events::*;
use crate::constants::*;

pub fn initiate_battle(ctx: Context<InitiateBattle>) -> Result<()> {
    let attacker = &mut ctx.accounts.attacker;
    let defender = &mut ctx.accounts.defender;
    let now = Clock::get()?.unix_timestamp;

    // Validate states, ensure neither side is already in battle or dead
    attacker.validate_state(now)?;
    defender.validate_state(now)?;

    // Mark them as in a battle
    attacker.current_battle_start = Some(now);
    defender.current_battle_start = Some(now);

    // Emit an event
    emit!(BattleInitiated {
        agent_id: attacker.id,
        opponent_agent_id: defender.id,
    });

    // TODO: Add real logic for calculating a winner, burning tokens, etc.
    // Possibly break out of battle afterwards or store results.

    Ok(())
}

#[derive(Accounts)]
pub struct InitiateBattle<'info> {
    #[account(mut, has_one = game, has_one = authority)]
    pub attacker: Account<'info, Agent>,

    #[account(mut, has_one = game)]
    pub defender: Account<'info, Agent>,

    pub game: Account<'info, Game>,

    #[account(mut)]
    pub authority: Signer<'info>,
}
