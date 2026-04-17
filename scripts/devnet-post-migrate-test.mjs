// Post-migrate deserialization proof test.
//
// Gap being closed: the 2026-04-16 smoke proved that migrate_pointer_account
// grows a 260-byte v1 PDA to 324 bytes and zero-fills the new region. It did
// NOT prove that a SUBSEQUENT instruction using Account<'info, Pointer> can
// then deserialize + mutate that migrated account.
//
// This script fires `transfer_inscriber` on D4pZb8Bx… (the migrated PDA on
// devnet), transfers the inscriber role to an ephemeral keypair, verifies
// the change, then transfers back. End-to-end proof that post-migrate
// Anchor deserialization + mutation works on a real 260→324 migrated PDA.
//
// Only needs authority keypair (D4pZb8Bx…'s recorded inscriber) + devnet RPC.

import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  ComputeBudgetProgram, SystemProgram, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

const PROGRAM_ID = new PublicKey('FrzDrykT4XSp5BwdYdSJdLHbDVVPuquN2cDMJyVJ35iJ');
const SEED = Buffer.from('fd-pointer');
const DISC_TRANSFER = createHash('sha256').update('global:transfer_inscriber').digest().subarray(0, 8);

const CONTENT_HASH = Buffer.from('6e06c40efecfb7a3e1795838c05c324cd68f32524340de9c435d85635efcfef7', 'hex');
const EXPECTED_PDA = 'D4pZb8BxtLvGv7pjqqdirdgRTYotoLcjn1cFyrkgSuj';
const RPC = process.env.DEVNET_RPC || 'https://api.devnet.solana.com';

function buildTransferIx({ pdaPubkey, currentInscriber, newInscriber }) {
  const data = Buffer.alloc(8 + 32);
  DISC_TRANSFER.copy(data, 0);
  newInscriber.toBuffer().copy(data, 8);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pdaPubkey, isSigner: false, isWritable: true },
      { pubkey: currentInscriber, isSigner: true, isWritable: false },
    ],
    data,
  });
}

async function readInscriber(conn, pda) {
  const info = await conn.getAccountInfo(pda);
  if (!info) throw new Error(`PDA ${pda.toBase58()} not found`);
  if (info.data.length !== 324) throw new Error(`PDA size ${info.data.length} — expected 324 post-migrate`);
  return new PublicKey(info.data.subarray(40, 72));
}

async function main() {
  const authority = Keypair.fromSecretKey(Buffer.from(JSON.parse(readFileSync(
    process.env.SIGNER_KEYPAIR || `${process.env.HOME}/.config/solana/new-wallet.json`, 'utf8'))));
  console.log('authority:', authority.publicKey.toBase58());

  const [pda, bump] = PublicKey.findProgramAddressSync([SEED, CONTENT_HASH], PROGRAM_ID);
  if (pda.toBase58() !== EXPECTED_PDA) throw new Error(`PDA mismatch: derived ${pda.toBase58()} vs expected ${EXPECTED_PDA}`);
  console.log('pda:', pda.toBase58(), 'bump:', bump);

  const conn = new Connection(RPC, 'confirmed');
  const current = await readInscriber(conn, pda);
  console.log('current inscriber:', current.toBase58());
  if (!current.equals(authority.publicKey)) {
    throw new Error(`Inscriber mismatch: on-chain ${current.toBase58()} vs authority ${authority.publicKey.toBase58()}`);
  }

  const ephemeral = Keypair.generate();
  console.log('\n[1/2] Transfer inscriber → ephemeral', ephemeral.publicKey.toBase58());
  const tx1 = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    buildTransferIx({ pdaPubkey: pda, currentInscriber: authority.publicKey, newInscriber: ephemeral.publicKey }),
  );
  const sig1 = await sendAndConfirmTransaction(conn, tx1, [authority], { commitment: 'confirmed' });
  console.log('  TX:', sig1);

  const afterTransfer = await readInscriber(conn, pda);
  console.log('  inscriber after transfer:', afterTransfer.toBase58());
  if (!afterTransfer.equals(ephemeral.publicKey)) {
    throw new Error(`Transfer failed: expected ${ephemeral.publicKey.toBase58()}, got ${afterTransfer.toBase58()}`);
  }
  console.log('  ✓ Anchor deserialized migrated PDA + mutation succeeded');

  console.log('\n[2/2] Transfer back → authority (authority = fee payer, ephemeral co-signs as current inscriber)');
  // Ephemeral never needs to exist on-chain — it just signs as current inscriber.
  // Authority pays the fee. Both signatures land in the TX.
  const tx2 = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    buildTransferIx({ pdaPubkey: pda, currentInscriber: ephemeral.publicKey, newInscriber: authority.publicKey }),
  );
  tx2.feePayer = authority.publicKey;
  const sig2 = await sendAndConfirmTransaction(conn, tx2, [authority, ephemeral], { commitment: 'confirmed' });
  console.log('  TX:', sig2);

  const restored = await readInscriber(conn, pda);
  console.log('  inscriber after restore:', restored.toBase58());
  if (!restored.equals(authority.publicKey)) {
    throw new Error(`Restore failed: expected ${authority.publicKey.toBase58()}, got ${restored.toBase58()}`);
  }

  console.log('\n✓ All checks passed:');
  console.log('  - PDA deserialized correctly post-migrate');
  console.log('  - transfer_inscriber wrote new value');
  console.log('  - ephemeral-signer path (different signer) also deserializes correctly');
  console.log('  - state restored to original inscriber');
}

main().catch((e) => { console.error('\n✗ FAILED:', e.message); process.exit(1); });
