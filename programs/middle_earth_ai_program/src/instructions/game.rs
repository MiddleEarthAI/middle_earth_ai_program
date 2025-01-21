use anchor_lang::prelude::*;
use crate::state::Game;
use crate::error::GameError;
use crate::constants::*;

pub fn initialize_game(ctx: Context<InitializeGame>, game_id: u32, bump: u8) -> Result<()> {
    let game_account = &mut ctx.accounts.game;

    // Ensure the game is not already active
    require!(!game_account.is_active, GameError::ReentrancyGuard);

    game_account.game_id = game_id as u64; 
    game_account.authority = ctx.accounts.authority.key();
    game_account.is_active = true;
    game_account.last_update = Clock::get()?.unix_timestamp;
    game_account.reentrancy_guard = false;
    game_account.bump = bump;

    Ok(())
}

pub fn end_game(ctx: Context<EndGame>) -> Result<()> {
    let game_account = &mut ctx.accounts.game;

    // Set the game to inactive
    require!(game_account.is_active, GameError::GameNotActive);
    game_account.is_active = false;

    // emit!(GameEnded { game_id: game_account.game_id });

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u32, bump: u8)]
pub struct InitializeGame<'info> {
    #[account(
        init,
        payer = authority,
        seeds = [
            b"game",
            &game_id.to_le_bytes()
        ],
        bump,
        space = 8 + Game::INIT_SPACE
    )]
    pub game: Account<'info, Game>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EndGame<'info> {
    #[account(
        mut,
        has_one = authority,
        constraint = game.is_active @ GameError::GameNotActive
    )]
    pub game: Account<'info, Game>,

    #[account(mut)]
    pub authority: Signer<'info>,
}
