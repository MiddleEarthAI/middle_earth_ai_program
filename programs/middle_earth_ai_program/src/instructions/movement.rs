use anchor_lang::prelude::*;
use crate::state::{Agent, Game, TerrainType}; // Import TerrainType from state directly.
use crate::error::GameError;
use crate::events::*; // Ensure AgentMoved event is defined

pub fn move_agent(
    ctx: Context<MoveAgent>,
    new_x: i32,
    new_y: i32,
    terrain: TerrainType,
) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let game = &ctx.accounts.game;
    let now = Clock::get()?.unix_timestamp;

    // Updated Access Control: Only the game authority can move agents.
    require!(game.authority == ctx.accounts.authority.key(), GameError::Unauthorized);

    // Check that the agent is alive.
    require!(agent.is_alive, GameError::AgentNotAlive);

    let old_x = agent.x;
    let old_y = agent.y;

    // Update position and record the move time.
    agent.x = new_x;
    agent.y = new_y;
    agent.last_move = now;

    // Apply terrain-based cooldown.
    agent.apply_terrain_move_cooldown(terrain, now); // Removed the `?`

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
        constraint = agent.is_alive @ GameError::AgentNotAlive
    )]
    pub agent: Account<'info, Agent>,
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub authority: Signer<'info>, // Now, authority is the game authority
}
