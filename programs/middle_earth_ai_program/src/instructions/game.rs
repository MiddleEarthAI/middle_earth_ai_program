use anchor_lang::prelude::*;
use crate::state::Game;
use crate::error::GameError;
use crate::constants::{VALID_COORDINATES, MOUNTAIN_COORDINATES, WATER_COORDINATES};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TerrainType {
    Mountain,
    Water,
    Plain,
}

pub fn initialize_game(ctx: Context<InitializeGame>, game_id: u32, bump: u8 ) -> Result<()> {
    let game_account = &mut ctx.accounts.game;

    // Ensure the game is not already active
    require!(!game_account.is_active, GameError::ReentrancyGuard);

    game_account.game_id = game_id as u64; 
    game_account.authority = ctx.accounts.authority.key();
    game_account.is_active = true;
    game_account.last_update = Clock::get()?.unix_timestamp;
    game_account.reentrancy_guard = false;
    game_account.bump = bump;
    game_account.daily_reward_tokens = 0;

    Ok(())
}

pub fn end_game(ctx: Context<EndGame>) -> Result<()> {
    let game_account = &mut ctx.accounts.game;

    // Set the game to inactive
    require!(game_account.is_active, GameError::GameNotActive);
    game_account.is_active = false;

    Ok(())
}

/// Returns the terrain type for a given coordinate
pub fn get_terrain_type(x: i32, y: i32) -> TerrainType {
    if MOUNTAIN_COORDINATES.contains(&(x, y)) {
        TerrainType::Mountain
    } else if WATER_COORDINATES.contains(&(x, y)) {
        TerrainType::Water
    } else if VALID_COORDINATES.contains(&(x, y)) {
        TerrainType::Plain
    } else {
        panic!("Invalid coordinate: ({}, {}). Ensure it is part of the map.", x, y);
    }
}

/// Checks if a given coordinate is valid on the map
pub fn is_valid_coordinate(x: i32, y: i32) -> bool {
    VALID_COORDINATES.contains(&(x, y))
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
