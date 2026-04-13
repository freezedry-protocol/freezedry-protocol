use anchor_lang::prelude::*;
use crate::state::Pointer;
use crate::error::PointerError;
use crate::events::NftLinked;

#[derive(Accounts)]
pub struct LinkNft<'info> {
    #[account(
        mut,
        seeds = [b"fd-pointer", pointer.content_hash.as_ref()],
        bump = pointer.bump,
        constraint = inscriber.key() == pointer.inscriber @ PointerError::NotInscriber,
        constraint = pointer.primary_nft == Pubkey::default() @ PointerError::AlreadyLinked,
    )]
    pub pointer: Account<'info, Pointer>,

    pub inscriber: Signer<'info>,
}

pub fn link_nft(ctx: Context<LinkNft>, nft_mint: Pubkey) -> Result<()> {
    let pointer = &mut ctx.accounts.pointer;
    pointer.primary_nft = nft_mint;

    emit!(NftLinked {
        content_hash: pointer.content_hash,
        nft_mint,
    });

    Ok(())
}
