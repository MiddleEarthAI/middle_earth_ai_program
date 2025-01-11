use anchor_lang::prelude::*;
use crate::state::{Agent, Game, IgnoreCooldown};
use crate::error::GameError;
use crate::constants::*;

pub fn ignore_agent(ctx: Context<IgnoreAgent>, target_agent_id: u8) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let now = Clock::get()?.unix_timestamp;

    // Add to ignore_cooldowns
    let cooldown = IgnoreCooldown {
        agent_id: target_agent_id,
        timestamp: now,
    };
    agent.ignore_cooldowns.push(cooldown);

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
