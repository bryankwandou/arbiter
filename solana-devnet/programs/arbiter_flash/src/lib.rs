//! Devnet test bed for Arbiter's atomic arbitrage.
//!
//! Solana devnet has no Aave and no deep DEX liquidity, so this program brings
//! both halves itself: a flash-loan vault and two constant-product pools. The
//! prices in those pools are set by whoever funds them, so an "edge" here proves
//! the mechanism — borrow, trade, repay, all or nothing — not that a real market
//! paid out.
//!
//! The loan is enforced the usual Solana way: `flash_borrow` refuses to lend
//! unless a matching `flash_repay` for the same vault and amount appears later
//! in the same transaction. If the trades in between do not return enough to
//! cover principal plus fee, the repay transfer fails and the whole transaction
//! reverts, loan included.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};
use anchor_lang::Discriminator;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("C1RWmeDJxaLciy6puyjxWMWFBbo5DWSTtGWaMsvVdFF1");

const BPS: u128 = 10_000;
/// Position of `vault` in `FlashRepay`'s account list; the borrow check reads it.
const REPAY_VAULT_INDEX: usize = 2;

#[program]
pub mod arbiter_flash {
    use super::*;

    pub fn init_vault(ctx: Context<InitVault>, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= 1_000, ArbError::FeeTooHigh);
        let v = &mut ctx.accounts.vault;
        v.mint = ctx.accounts.mint.key();
        v.fee_bps = fee_bps;
        v.outstanding = 0;
        v.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.depositor_token.to_account_info(),
                    to: ctx.accounts.vault_tokens.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            amount,
        )
    }

    pub fn init_pool(ctx: Context<InitPool>, id: u8, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= 1_000, ArbError::FeeTooHigh);
        let p = &mut ctx.accounts.pool;
        p.id = id;
        p.mint_a = ctx.accounts.mint_a.key();
        p.mint_b = ctx.accounts.mint_b.key();
        p.fee_bps = fee_bps;
        p.bump = ctx.bumps.pool;
        Ok(())
    }

    pub fn add_liquidity(ctx: Context<AddLiquidity>, amount_a: u64, amount_b: u64) -> Result<()> {
        let a = &ctx.accounts;
        for (from, to, amt) in [
            (&a.provider_a, &a.reserve_a, amount_a),
            (&a.provider_b, &a.reserve_b, amount_b),
        ] {
            if amt > 0 {
                token::transfer(
                    CpiContext::new(
                        a.token_program.to_account_info(),
                        Transfer {
                            from: from.to_account_info(),
                            to: to.to_account_info(),
                            authority: a.provider.to_account_info(),
                        },
                    ),
                    amt,
                )?;
            }
        }
        Ok(())
    }

    pub fn swap(ctx: Context<Swap>, a_to_b: bool, amount_in: u64, min_out: u64) -> Result<()> {
        let a = &ctx.accounts;
        let (r_in, r_out) = if a_to_b {
            (a.reserve_a.amount, a.reserve_b.amount)
        } else {
            (a.reserve_b.amount, a.reserve_a.amount)
        };
        let in_after_fee = amount_in as u128 * (BPS - a.pool.fee_bps as u128);
        let out = (in_after_fee * r_out as u128) / (r_in as u128 * BPS + in_after_fee);
        let out = u64::try_from(out).map_err(|_| ArbError::MathOverflow)?;
        require!(out > 0 && out >= min_out, ArbError::Slippage);

        let (user_in, res_in, res_out, user_out) = if a_to_b {
            (&a.user_a, &a.reserve_a, &a.reserve_b, &a.user_b)
        } else {
            (&a.user_b, &a.reserve_b, &a.reserve_a, &a.user_a)
        };
        token::transfer(
            CpiContext::new(
                a.token_program.to_account_info(),
                Transfer {
                    from: user_in.to_account_info(),
                    to: res_in.to_account_info(),
                    authority: a.user.to_account_info(),
                },
            ),
            amount_in,
        )?;
        let id = [a.pool.id];
        let seeds: &[&[u8]] = &[b"pool", &id, &[a.pool.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                a.token_program.to_account_info(),
                Transfer {
                    from: res_out.to_account_info(),
                    to: user_out.to_account_info(),
                    authority: a.pool.to_account_info(),
                },
                &[seeds],
            ),
            out,
        )?;
        emit!(Swapped { pool: a.pool.id, a_to_b, amount_in, amount_out: out });
        Ok(())
    }

    pub fn flash_borrow(ctx: Context<FlashBorrow>, amount: u64) -> Result<()> {
        require!(ctx.accounts.vault.outstanding == 0, ArbError::LoanOutstanding);

        let ixs = ctx.accounts.instructions.to_account_info();
        let current = load_current_index_checked(&ixs)? as usize;
        // A CPI caller would show up as a different top-level program here.
        let me = load_instruction_at_checked(current, &ixs)?;
        require_keys_eq!(me.program_id, crate::ID, ArbError::NoCpiBorrow);

        let vault_key = ctx.accounts.vault.key();
        let mut repaid_later = false;
        let mut i = current + 1;
        while let Ok(ix) = load_instruction_at_checked(i, &ixs) {
            if ix.program_id == crate::ID
                && ix.data.len() >= 16
                && &ix.data[..8] == instruction::FlashRepay::DISCRIMINATOR
                && ix.data[8..16] == amount.to_le_bytes()
                && ix.accounts.get(REPAY_VAULT_INDEX).map(|m| m.pubkey) == Some(vault_key)
            {
                repaid_later = true;
                break;
            }
            i += 1;
        }
        require!(repaid_later, ArbError::MissingRepay);

        let mint = ctx.accounts.vault.mint;
        let bump = ctx.accounts.vault.bump;
        let seeds: &[&[u8]] = &[b"vault", mint.as_ref(), &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_tokens.to_account_info(),
                    to: ctx.accounts.borrower_token.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        ctx.accounts.vault.outstanding = amount;
        Ok(())
    }

    pub fn flash_repay(ctx: Context<FlashRepay>, amount: u64) -> Result<()> {
        require!(ctx.accounts.vault.outstanding == amount, ArbError::RepayMismatch);
        let fee = (amount as u128 * ctx.accounts.vault.fee_bps as u128).div_ceil(BPS) as u64;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.borrower_token.to_account_info(),
                    to: ctx.accounts.vault_tokens.to_account_info(),
                    authority: ctx.accounts.borrower.to_account_info(),
                },
            ),
            amount.checked_add(fee).ok_or(ArbError::MathOverflow)?,
        )?;
        ctx.accounts.vault.outstanding = 0;
        emit!(FlashLoanRepaid { vault: ctx.accounts.vault.key(), amount, fee });
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub mint: Pubkey,
    pub fee_bps: u16,
    pub outstanding: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub id: u8,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub fee_bps: u16,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(init, payer = payer, space = 8 + Vault::INIT_SPACE, seeds = [b"vault", mint.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    #[account(init, payer = payer, seeds = [b"vault_tokens", vault.key().as_ref()], bump,
              token::mint = mint, token::authority = vault)]
    pub vault_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub depositor: Signer<'info>,
    #[account(mut, token::mint = vault.mint)]
    pub depositor_token: Account<'info, TokenAccount>,
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"vault_tokens", vault.key().as_ref()], bump)]
    pub vault_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(id: u8)]
pub struct InitPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint_a: Account<'info, Mint>,
    pub mint_b: Account<'info, Mint>,
    #[account(init, payer = payer, space = 8 + Pool::INIT_SPACE, seeds = [b"pool", id.to_le_bytes().as_ref()], bump)]
    pub pool: Account<'info, Pool>,
    #[account(init, payer = payer, seeds = [b"res_a", pool.key().as_ref()], bump,
              token::mint = mint_a, token::authority = pool)]
    pub reserve_a: Account<'info, TokenAccount>,
    #[account(init, payer = payer, seeds = [b"res_b", pool.key().as_ref()], bump,
              token::mint = mint_b, token::authority = pool)]
    pub reserve_b: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    pub provider: Signer<'info>,
    #[account(mut, token::mint = pool.mint_a)]
    pub provider_a: Account<'info, TokenAccount>,
    #[account(mut, token::mint = pool.mint_b)]
    pub provider_b: Account<'info, TokenAccount>,
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"res_a", pool.key().as_ref()], bump)]
    pub reserve_a: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"res_b", pool.key().as_ref()], bump)]
    pub reserve_b: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    pub user: Signer<'info>,
    #[account(mut, token::mint = pool.mint_a)]
    pub user_a: Account<'info, TokenAccount>,
    #[account(mut, token::mint = pool.mint_b)]
    pub user_b: Account<'info, TokenAccount>,
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"res_a", pool.key().as_ref()], bump)]
    pub reserve_a: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"res_b", pool.key().as_ref()], bump)]
    pub reserve_b: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FlashBorrow<'info> {
    pub borrower: Signer<'info>,
    #[account(mut, token::mint = vault.mint)]
    pub borrower_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"vault_tokens", vault.key().as_ref()], bump)]
    pub vault_tokens: Account<'info, TokenAccount>,
    /// CHECK: address-constrained to the instructions sysvar
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Account order matters: `flash_borrow` looks for `vault` at REPAY_VAULT_INDEX.
#[derive(Accounts)]
pub struct FlashRepay<'info> {
    pub borrower: Signer<'info>,
    #[account(mut, token::mint = vault.mint)]
    pub borrower_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"vault_tokens", vault.key().as_ref()], bump)]
    pub vault_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct Swapped {
    pub pool: u8,
    pub a_to_b: bool,
    pub amount_in: u64,
    pub amount_out: u64,
}

#[event]
pub struct FlashLoanRepaid {
    pub vault: Pubkey,
    pub amount: u64,
    pub fee: u64,
}

#[error_code]
pub enum ArbError {
    #[msg("fee above 10%")]
    FeeTooHigh,
    #[msg("a flash loan is already outstanding")]
    LoanOutstanding,
    #[msg("flash_borrow must be called directly, not via CPI")]
    NoCpiBorrow,
    #[msg("no matching flash_repay later in this transaction")]
    MissingRepay,
    #[msg("repay amount does not match the outstanding loan")]
    RepayMismatch,
    #[msg("output below minimum")]
    Slippage,
    #[msg("math overflow")]
    MathOverflow,
}
