use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;
use crate::constants::*;
use crate::agent::*; // Import validate_alliance
use crate::state::Alliance;

pub fn form_alliance(ctx: Context<FormAlliance>) -> Result<()> {
    let initiator = &mut ctx.accounts.initiator;
    let target = &mut ctx.accounts.target_agent;
    let game = &mut ctx.accounts.game;
    let now = Clock::get()?.unix_timestamp;
    
    // Validate that the initiator can form a new alliance
    initiator.validate_alliance(now)?;
    
    // Prevent self-alliances.
    if initiator.key() == target.key() {
        return err!(GameError::InvalidAlliancePartner);
    }
    
    // Check that neither agent is already in an active alliance.
    if initiator.alliance_with.is_some() || target.alliance_with.is_some() {
        return err!(GameError::AllianceAlreadyExists);
    }
    
    // Update the agents’ alliance fields.
    initiator.alliance_with = Some(target.key());
    initiator.alliance_timestamp = now;
    target.alliance_with = Some(initiator.key());
    target.alliance_timestamp = now;
    
    // Search for an existing alliance between these two agents.
    if let Some(existing_alliance) = game.alliances.iter_mut().find(|a| {
        (a.agent1 == initiator.key() && a.agent2 == target.key()) ||
        (a.agent1 == target.key() && a.agent2 == initiator.key())
    }) {
        // If the alliance exists and is inactive, reactivate it.
        if !existing_alliance.is_active {
            existing_alliance.is_active = true;
            existing_alliance.formed_at = now;
        } else {
            return err!(GameError::AllianceAlreadyExists);
        }
    } else {
        // Otherwise, push a new alliance record.
        game.alliances.push(Alliance {
            agent1: initiator.key(),
            agent2: target.key(),
            formed_at: now,
            is_active: true,
        });
    }
    
    Ok(())
}


pub fn break_alliance(ctx: Context<BreakAlliance>) -> Result<()> {
    let initiator = &mut ctx.accounts.initiator;
    let target = &mut ctx.accounts.target_agent;
    let game = &mut ctx.accounts.game;
    
    // Check that the initiator is allied with the target.
    if initiator.alliance_with.is_none() || initiator.alliance_with.unwrap() != target.key() {
        return err!(GameError::NoAllianceToBreak);
    }
    
    // Clear the alliance fields for both agents.
    initiator.alliance_with = None;
    initiator.alliance_timestamp = 0;
    target.alliance_with = None;
    target.alliance_timestamp = 0;
    
    // Find the alliance in the global list and mark it as inactive.
    if let Some(alliance) = game.alliances.iter_mut().find(|a| {
         a.is_active &&
         ((a.agent1 == initiator.key() && a.agent2 == target.key()) ||
          (a.agent1 == target.key() && a.agent2 == initiator.key()))
    }) {
         alliance.is_active = false;
    } else {
         return err!(GameError::AllianceNotFound);
    }
    
    Ok(())
}

#[derive(Accounts)]
pub struct FormAlliance<'info> {
    /// The initiating agent (must be mutable and signed).
    #[account(mut, has_one = game, has_one = authority)]
    pub initiator: Account<'info, Agent>,
    /// The target agent that the initiator wants to form an alliance with.
    #[account(mut, has_one = game)]
    pub target_agent: Account<'info, Agent>,
    /// The global game state holding the alliance list.
    #[account(mut)]
    pub game: Account<'info, Game>,
    /// The signer for the initiating agent.
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct BreakAlliance<'info> {
    /// The initiating agent (mutable and signed) that wants to break the alliance.
    #[account(mut, has_one = game, has_one = authority)]
    pub initiator: Account<'info, Agent>,
    /// The allied (or target) agent for the alliance.
    #[account(mut, has_one = game)]
    pub target_agent: Account<'info, Agent>,
    /// The global game state holding the alliance list.
    #[account(mut)]
    pub game: Account<'info, Game>,
    /// The signer for the initiating agent.
    #[account(mut)]
    pub authority: Signer<'info>,
}