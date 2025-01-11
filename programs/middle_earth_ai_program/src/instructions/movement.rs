use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;
use crate::constants::*;
use crate::events::*; // if you want to emit events

pub fn move_agent(ctx: Context<MoveAgent>, new_x: i32, new_y: i32) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let game = &ctx.accounts.game;
    let now = Clock::get()?.unix_timestamp;

    // Validate if movement is allowed using the helper function in the Agent struct.
    agent.validate_movement(new_x, new_y, game.map_diameter, now)?;

    // Store old position for potential events.
    let old_x = agent.x;
    let old_y = agent.y;

    // Update agent's position and record the movement time.
    agent.x = new_x;
    agent.y = new_y;
    agent.last_move = now;

    // Optionally, emit an event to signal that the agent has moved.
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
