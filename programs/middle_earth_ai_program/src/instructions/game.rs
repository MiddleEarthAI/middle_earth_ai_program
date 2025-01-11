use anchor_lang::prelude::*;
use crate::state::Game;       // Import the data model from state/game.rs
use crate::error::GameError;  // If you have custom errors
use crate::constants::*;      // If you have config constants

/// Instruction handler to create (initialize) a new Game account.
pub fn initialize_game(ctx: Context<InitializeGame>, game_id: u64) -> Result<()> {
    let game_account = &mut ctx.accounts.game;
    
    // A simple guard: if the game is already active, we can return an error
    require!(!game_account.is_active, GameError::ReentrancyGuard);

    // Set fields
    game_account.game_id        = game_id;
    game_account.authority      = *ctx.accounts.authority.key;
    game_account.map_diameter   = MAP_DIAMETER;  // from constants
    game_account.battle_range   = BATTLE_RANGE;  // from constants
    game_account.is_active      = true;
    game_account.last_update    = Clock::get()?.unix_timestamp;
    game_account.reentrancy_guard = false;

    // The `bump` is retrieved from Anchor’s `ctx.bumps` map
    // if you used seeds = [b"game", &game_id.to_le_bytes()], bump
    game_account.bump = *ctx.bumps.get("game").unwrap();

    Ok(())
}

/// The `#[derive(Accounts)]` struct defines which accounts must be provided 
/// to call `initialize_game` on-chain.
#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct InitializeGame<'info> {
    /// The new Game account, created via PDA seeds.
    #[account(
        init,
        payer = authority,
        seeds = [b"game", &game_id.to_le_bytes()],
        bump,
        space = 8 + Game::INIT_SPACE
    )]
    pub game: Account<'info, Game>,

    /// The user who is paying rent + fees (and presumably controlling the Game).
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Required program to create system accounts
    pub system_program: Program<'info, System>,
}
