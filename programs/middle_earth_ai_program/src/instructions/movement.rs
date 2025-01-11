use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;
use crate::events::*;
use crate::constants::*;

pub fn move_agent(ctx: Context<MoveAgent>, new_x: i32, new_y: i32) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let game_account = &ctx.accounts.game;
    let now = Clock::get()?.unix_timestamp;

    // Use the helper method from Agent
    agent.validate_movement(new_x, new_y, game_account.map_diameter, now)?;

    // Save old pos for event emission
    let old_x = agent.x;
    let old_y = agent.y;

    // Update the agent
    agent.x = new_x;
    agent.y = new_y;
    agent.last_move = now;

    // Optionally, emit an event
    emit!(AgentMoved {
        agent_id: agent.id,
        old_x,
        old_y,
        new_x,
        new_y
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
