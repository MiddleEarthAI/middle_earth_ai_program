use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;
use crate::constants::*;

pub fn form_alliance(ctx: Context<FormAlliance>, target_agent_id: u8) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let now = Clock::get()?.unix_timestamp;

    // Validate state
    agent.validate_state(now)?;

    // Set alliance
    agent.alliance_with = Some(target_agent_id);
    agent.alliance_timestamp = now;

    Ok(())
}

pub fn break_alliance(ctx: Context<BreakAlliance>) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    agent.alliance_with = None;
    agent.alliance_timestamp = 0;

    Ok(())
}

#[derive(Accounts)]
pub struct FormAlliance<'info> {
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,

    pub game: Account<'info, Game>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct BreakAlliance<'info> {
    #[account(mut, has_one = game, has_one = authority)]
    pub agent: Account<'info, Agent>,

    pub game: Account<'info, Game>,

    #[account(mut)]
    pub authority: Signer<'info>,
}