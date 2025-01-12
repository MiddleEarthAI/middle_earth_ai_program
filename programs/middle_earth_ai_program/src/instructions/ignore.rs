use anchor_lang::prelude::*;
use crate::state::{Agent, Game, IgnoreCooldown};
use crate::error::GameError;
use crate::constants::*;

pub fn ignore_agent(ctx: Context<IgnoreAgent>, target_agent_id: u8) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let now = Clock::get()?.unix_timestamp;

    // Validate that the ignore action is off cooldown (4-hour cooldown)
    agent.validate_ignore(now)?;

    // Record the ignore action.
    let cooldown = IgnoreCooldown {
        agent_id: target_agent_id,
        timestamp: now,
    };
    agent.ignore_cooldowns.push(cooldown);

    // Update the last_ignore timestamp.
    agent.last_ignore = now;

    Ok(())
}

#[derive(Accounts)]
pub struct IgnoreAgent<'info> {
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub authority: Signer<'info>,
}
