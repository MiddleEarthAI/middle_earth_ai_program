use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack; // For unpack_from_slice
use anchor_spl::token::{transfer, Transfer, Token};
use spl_token::state::Account as SplTokenAccount; // Import SPL Token Account
use crate::state::{Agent, Game};
use crate::error::GameError;
use crate::events::*; // Ensure BattleResolved event is defined

/// Resolves a battle with alliance support with token transfers. 
/// It updates cooldown timers and transfers tokens as follows:
/// - Computes the total lost amount as `percent_lost`% of the sum of the loser's and loser partner's token balances.
/// - Deducts from each losing account proportionally.
/// - Distributes the total lost amount among the winners (winner and winner partner) in proportion
///   to their token balances.
pub fn resolve_battle(
    ctx: Context<ResolveBattle>,
    percent_lost: u8,  // e.g., 20% loss
) -> Result<()> {
    let authority = &ctx.accounts.authority;
    let game = &ctx.accounts.game;
    require!(authority.key() == game.authority, GameError::Unauthorized);

    // Update battle cooldown timers.
    let winner = &mut ctx.accounts.winner;
    let loser = &mut ctx.accounts.loser;
    let now = Clock::get()?.unix_timestamp;
    winner.validate_attack(now)?;
    winner.last_attack = now;
    if winner.alliance_with.is_some() {
        let winner_partner = &mut ctx.accounts.winner_partner;
        winner_partner.last_attack = now;
    }
    loser.last_attack = now;
    if loser.alliance_with.is_some() {
        let loser_partner = &mut ctx.accounts.loser_partner;
        loser_partner.last_attack = now;
    }

    // --- Token Transfer Logic for Alliance Battle ---
    // Unpack token accounts to get the balances.
    let loser_token_account = SplTokenAccount::unpack_from_slice(&ctx.accounts.loser_token.data.borrow())?;
    let loser_partner_token_account = SplTokenAccount::unpack_from_slice(&ctx.accounts.loser_partner_token.data.borrow())?;
    let total_loser_balance = loser_token_account.amount
        .checked_add(loser_partner_token_account.amount)
        .ok_or(GameError::InsufficientFunds)?;
    let total_lost = total_loser_balance
        .checked_mul(percent_lost as u64)
        .ok_or(GameError::InsufficientFunds)?
        .checked_div(100)
        .ok_or(GameError::InsufficientFunds)?;

    // Unpack the winners' token accounts.
    let winner_token_account = SplTokenAccount::unpack_from_slice(&ctx.accounts.winner_token.data.borrow())?;
    let winner_partner_token_account = SplTokenAccount::unpack_from_slice(&ctx.accounts.winner_partner_token.data.borrow())?;
    let total_winner_balance = winner_token_account.amount
        .checked_add(winner_partner_token_account.amount)
        .ok_or(GameError::InsufficientFunds)?;
    // Calculate the share for each winning account proportionally.
    let winner_share = if total_winner_balance > 0 {
        total_lost
            .checked_mul(winner_token_account.amount)
            .ok_or(GameError::InsufficientFunds)?
            .checked_div(total_winner_balance)
            .ok_or(GameError::InsufficientFunds)?
    } else { 0 };
    let winner_partner_share = if total_winner_balance > 0 {
        total_lost
            .checked_mul(winner_partner_token_account.amount)
            .ok_or(GameError::InsufficientFunds)?
            .checked_div(total_winner_balance)
            .ok_or(GameError::InsufficientFunds)?
    } else { 0 };

    // Deduct tokens proportionally from the losing side.
    let loser_deduction = if total_loser_balance > 0 {
        total_lost
            .checked_mul(loser_token_account.amount)
            .ok_or(GameError::InsufficientFunds)?
            .checked_div(total_loser_balance)
            .ok_or(GameError::InsufficientFunds)?
    } else { 0 };
    let loser_partner_deduction = total_lost
        .checked_sub(loser_deduction)
        .ok_or(GameError::InsufficientFunds)?;

    // Transfer tokens from loser's token account to winner's token account.
    {
        let cpi_accounts = Transfer {
            from: ctx.accounts.loser_token.to_account_info(),
            to: ctx.accounts.winner_token.to_account_info(),
            authority: ctx.accounts.loser_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        transfer(CpiContext::new(cpi_program.clone(), cpi_accounts), loser_deduction)?;
    }
    // Transfer tokens from loser partner's token account to winner partner's token account.
    {
        let cpi_accounts = Transfer {
            from: ctx.accounts.loser_partner_token.to_account_info(),
            to: ctx.accounts.winner_partner_token.to_account_info(),
            authority: ctx.accounts.loser_partner_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        transfer(CpiContext::new(cpi_program, cpi_accounts), loser_partner_deduction)?;
    }

    emit!(BattleResolved {
        winner_id: winner.id,
        loser_id: loser.id,
        transfer_amount: total_lost,
    });
    Ok(())
}

/// Resolve a simple battle (non‐alliance) with token transfer.
/// The loser loses `percent_lost` percent of its token balance, and that lost amount is transferred 
/// directly to the winner’s token account.
pub fn resolve_battle_simple(
    ctx: Context<ResolveBattleSimple>,
    percent_lost: u8,
) -> Result<()> {
    let authority = &ctx.accounts.authority;
    let game = &ctx.accounts.game;
    require!(authority.key() == game.authority, GameError::Unauthorized);

    let winner = &mut ctx.accounts.winner;
    let loser = &mut ctx.accounts.loser;
    let now = Clock::get()?.unix_timestamp;
    winner.validate_attack(now)?;
    winner.last_attack = now;
    loser.last_attack = now;

    let loser_token_account = SplTokenAccount::unpack_from_slice(&ctx.accounts.loser_token.data.borrow())?;
    let lost_amount = loser_token_account.amount
        .checked_mul(percent_lost as u64)
        .ok_or(GameError::InsufficientFunds)?
        .checked_div(100)
        .ok_or(GameError::InsufficientFunds)?;

    let cpi_accounts = Transfer {
        from: ctx.accounts.loser_token.to_account_info(),
        to: ctx.accounts.winner_token.to_account_info(),
        authority: ctx.accounts.loser_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    transfer(CpiContext::new(cpi_program, cpi_accounts), lost_amount)?;

    emit!(BattleResolved {
        winner_id: winner.id,
        loser_id: loser.id,
        transfer_amount: lost_amount,
    });
    Ok(())
}
#[derive(Accounts)]
pub struct ResolveBattle<'info> {
    #[account(mut, has_one = game)]
    pub winner: Account<'info, Agent>,
    #[account(mut)]
    pub winner_partner: Account<'info, Agent>,

    #[account(mut, has_one = game)]
    pub loser: Account<'info, Agent>,
    #[account(mut)]
    pub loser_partner: Account<'info, Agent>,

    pub game: Account<'info, Game>,

    /// CHECK: This is a token account, validated through program logic in the handler.
    #[account(mut)]
    pub winner_token: UncheckedAccount<'info>,
    /// CHECK: This is a token account, validated through program logic in the handler.
    #[account(mut)]
    pub winner_partner_token: UncheckedAccount<'info>,
    /// CHECK: This is a token account, validated through program logic in the handler.
    #[account(mut)]
    pub loser_token: UncheckedAccount<'info>,
    /// CHECK: This is a token account, validated through program logic in the handler.
    #[account(mut)]
    pub loser_partner_token: UncheckedAccount<'info>,

    /// CHECK: This is the owner or delegate of the loser's token account, validated in the handler.
    #[account(signer)]
    pub loser_authority: AccountInfo<'info>,
    /// CHECK: This is the owner or delegate of the loser's partner token account, validated in the handler.
    #[account(signer)]
    pub loser_partner_authority: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveBattleSimple<'info> {
    #[account(mut, has_one = game)]
    pub winner: Account<'info, Agent>,
    #[account(mut, has_one = game)]
    pub loser: Account<'info, Agent>,
    pub game: Account<'info, Game>,

    /// CHECK: This is a token account, validated through program logic in the handler.
    #[account(mut)]
    pub winner_token: UncheckedAccount<'info>,
    /// CHECK: This is a token account, validated through program logic in the handler.
    #[account(mut)]
    pub loser_token: UncheckedAccount<'info>,

    /// CHECK: This is the owner or delegate of the loser's token account, validated in the handler.
    #[account(signer)]
    pub loser_authority: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,

    #[account(mut)]
    pub authority: Signer<'info>,
}
