
use anchor_lang::prelude::*;
use crate::state::Game;
use crate::error::GameError;
use crate::constants::*;

// The instruction now has 3 parameters: (1) `game_id`, (2) `bump`, (3) ctx
pub fn initialize_game(ctx: Context<InitializeGame>, game_id: u32, bump: u8) -> Result<()> {
    let game_account = &mut ctx.accounts.game;

    // Example check
    require!(!game_account.is_active, GameError::ReentrancyGuard);

    game_account.game_id = game_id as u64; 
    game_account.authority = ctx.accounts.authority.key();
    game_account.battle_range = BATTLE_RANGE;
    game_account.is_active = true;
    game_account.last_update = Clock::get()?.unix_timestamp;
    game_account.reentrancy_guard = false;

    // Set the bump that was passed in
    game_account.bump = bump;

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u32, bump: u8)]
pub struct InitializeGame<'info> {
    #[account(
        init,
        payer = authority,
        // Seeds: 4 bytes if `game_id` is `u32`
        // Anchor will match the `bump` you pass in the instruction
        seeds = [
            b"game",
            &game_id.to_le_bytes()
        ],
        bump,                        // We match the "bump" argument here
        space = 8 + Game::INIT_SPACE
    )]
    pub game: Account<'info, Game>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}
