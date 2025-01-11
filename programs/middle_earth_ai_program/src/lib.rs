use anchor_lang::prelude::*;

declare_id!("FE7WJhRY55XjHcR22ryA3tHLq6fkDNgZBpbh25tto67Q");

#[program]
pub mod middle_earth_ai_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
