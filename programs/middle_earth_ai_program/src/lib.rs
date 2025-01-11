use anchor_lang::prelude::*;

declare_id!("FE7WJhRY55XjHcR22ryA3tHLq6fkDNgZBpbh25tto67Q");

// Add these lines:
pub mod constants;
pub mod error;
pub mod events;
pub mod state;
#[program]
pub mod middle_earth_ai_program {
    use super::*;

    pub fn placeholder(_ctx: Context<Placeholder>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Placeholder {}
