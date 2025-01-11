use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod state;
pub mod instructions;
pub mod utils;  // <-- Add this line

declare_id!("FE7WJhRY55XjHcR22ryA3tHLq6fkDNgZBpbh25tto67Q");

use instructions::*;

#[program]
pub mod middle_earth_ai_program {
    use super::*;

    // ... your existing program entrypoints ...
}

#[derive(Accounts)]
pub struct Placeholder {}
