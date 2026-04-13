use anchor_lang::prelude::*;
use crate::state::Pointer;
use crate::error::PointerError;
use crate::events::CollectionSet;

#[derive(Accounts)]
pub struct SetCollection<'info> {
    #[account(
        mut,
        seeds = [b"fd-pointer", pointer.content_hash.as_ref()],
        bump = pointer.bump,
        constraint = inscriber.key() == pointer.inscriber @ PointerError::NotInscriber,
        constraint = pointer.collection == Pubkey::default() @ PointerError::CollectionAlreadySet,
    )]
    pub pointer: Account<'info, Pointer>,

    pub inscriber: Signer<'info>,
}

pub fn set_collection(ctx: Context<SetCollection>, collection: Pubkey) -> Result<()> {
    let pointer = &mut ctx.accounts.pointer;
    pointer.collection = collection;

    emit!(CollectionSet {
        content_hash: pointer.content_hash,
        collection,
    });

    Ok(())
}
