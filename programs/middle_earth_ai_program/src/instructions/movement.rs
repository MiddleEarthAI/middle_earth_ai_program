use anchor_lang::prelude::*;
use crate::state::{Agent, Game, TerrainType}; // Import TerrainType from state directly.
use crate::error::GameError;
use crate::constants::*;
use crate::events::*; // if you want to emit events

// The move_agent instruction now takes a terrain parameter.
pub fn move_agent(
    ctx: Context<MoveAgent>,
    new_x: i32,
    new_y: i32,
    terrain: TerrainType,
) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let _game = &ctx.accounts.game; // game can be used for additional validations if needed
    let now = Clock::get()?.unix_timestamp;

    // Validate that movement is allowed (i.e. that the cooldown has expired).
    agent.validate_movement(now)?;

    // Optionally, store the old position for events.
    let old_x = agent.x;
    let old_y = agent.y;

    // Update position and record the move time.
    agent.x = new_x;
    agent.y = new_y;
    agent.last_move = now;

    // Apply terrain-based cooldown:
    // Plain = 1 hour, River = 2 hours, Mountain = 3 hours.
    agent.apply_terrain_move_cooldown(terrain, now);

    // Emit an event indicating the move.
    emit!(AgentMoved {
        agent_id: agent.id,
        old_x,
        old_y,
        new_x,
        new_y,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct MoveAgent<'info> {
    #[account(
        mut,
        has_one = game,
        has_one = authority,
        constraint = agent.is_alive @ GameError::AgentNotAlive
    )]
    pub agent: Account<'info, Agent>,
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub authority: Signer<'info>,
}
