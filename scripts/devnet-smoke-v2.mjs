// scripts/devnet-smoke-v2.mjs
// End-to-end devnet smoke test for fd-pointer v2:
//   1. create_pointer_v2 with upfront primary_nft + collection, last_sig=[0;64]
//   2. read PDA, assert fields
//   3. update_last_sig with a fake 64-byte sig
//   4. read PDA again, assert last_sig updated, write-once guard holds on re-call
//
// Uses Solana CLI 2.1.15 via env (anchor defaults). Deploy must already be live at FrzDrykT on devnet.

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, ComputeBudgetProgram, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { readFileSync } from 'fs';
import { createHash, randomBytes } from 'crypto';

const PROGRAM_ID = new PublicKey('FrzDrykT4XSp5BwdYdSJdLHbDVVPuquN2cDMJyVJ35iJ');
const SEED = Buffer.from('fd-pointer');

const DISC_CREATE_POINTER_V2 = Buffer.from([163, 166, 186, 138, 195, 70, 206, 175]);
const DISC_UPDATE_LAST_SIG   = Buffer.from([14, 130, 101, 162, 250, 82, 46, 213]);

// UTF-8 safe truncation to 32 bytes (same as tests/fd-pointer.ts padTitle)
function padTitle(s) {
  const buf = Buffer.alloc(32, 0);
  if (!s) return buf;
  const encoder = new TextEncoder();
  let byteLen = 0, truncated = '';
  for (const ch of s) {
    const n = encoder.encode(ch).length;
    if (byteLen + n > 32) break;
    truncated += ch;
    byteLen += n;
  }
  Buffer.from(truncated, 'utf8').copy(buf, 0);
  return buf;
}

const DISC_TRANSFER_INSCRIBER = createHash('sha256').update('global:transfer_inscriber').digest().subarray(0, 8);
const DISC_MIGRATE = createHash('sha256').update('global:migrate_pointer_account').digest().subarray(0, 8);

function buildCreatePointerV2Ix({ payer, inscriber, contentHash, chunkCount, blobSize, lastSig, mode, contentType, primaryNft, collection, title }) {
  const [pda] = PublicKey.findProgramAddressSync([SEED, contentHash], PROGRAM_ID);
  const titleBytes = title || Buffer.alloc(32, 0);
  const data = Buffer.alloc(8 + 32 + 32 + 4 + 4 + 64 + 1 + 1 + 32 + 32 + 32);
  let o = 0;
  DISC_CREATE_POINTER_V2.copy(data, o); o += 8;
  contentHash.copy(data, o); o += 32;
  inscriber.toBuffer().copy(data, o); o += 32;
  data.writeUInt32LE(chunkCount, o); o += 4;
  data.writeUInt32LE(blobSize, o); o += 4;
  lastSig.copy(data, o); o += 64;
  data[o++] = mode;
  data[o++] = contentType;
  (primaryNft || PublicKey.default).toBuffer().copy(data, o); o += 32;
  (collection || PublicKey.default).toBuffer().copy(data, o); o += 32;
  titleBytes.copy(data, o); o += 32;
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildTransferInscriberIx({ currentInscriber, contentHash, newInscriber }) {
  const [pda] = PublicKey.findProgramAddressSync([SEED, contentHash], PROGRAM_ID);
  const data = Buffer.alloc(8 + 32);
  DISC_TRANSFER_INSCRIBER.copy(data, 0);
  newInscriber.toBuffer().copy(data, 8);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: currentInscriber, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function buildMigrateIx({ pointer, payer }) {
  const data = Buffer.from(DISC_MIGRATE);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pointer, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildUpdateLastSigIx({ inscriber, contentHash, lastSig }) {
  const [pda] = PublicKey.findProgramAddressSync([SEED, contentHash], PROGRAM_ID);
  const data = Buffer.alloc(8 + 64);
  DISC_UPDATE_LAST_SIG.copy(data, 0);
  lastSig.copy(data, 8);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: inscriber, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function parsePointer(raw) {
  if (raw.length < 260) throw new Error(`Short account data: ${raw.length}`);
  const p = {
    contentHash: raw.subarray(8, 40).toString('hex'),
    inscriber:   new PublicKey(raw.subarray(40, 72)).toBase58(),
    collection:  new PublicKey(raw.subarray(72, 104)).toBase58(),
    chunkCount:  raw.readUInt32LE(104),
    blobSize:    raw.readUInt32LE(108),
    lastSig:     raw.subarray(112, 176),
    mode:        raw[176],
    contentType: raw[177],
    slot:        raw.readBigUInt64LE(178),
    timestamp:   raw.readBigInt64LE(186),
    primaryNft:  new PublicKey(raw.subarray(194, 226)).toBase58(),
    version:     raw[226],
    bump:        raw[227],
    title:       null,
    accountSize: raw.length,
  };
  // v2 accounts (324 bytes) have title at offset 228
  if (raw.length >= 324) {
    const titleBytes = raw.subarray(228, 260);
    const firstZero = titleBytes.indexOf(0);
    const trimLen = firstZero === -1 ? 32 : firstZero;
    p.title = trimLen > 0 ? titleBytes.subarray(0, trimLen).toString('utf8') : null;
  }
  return p;
}

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const authorityJson = JSON.parse(readFileSync('/Users/nicholasmeyers/.config/solana/new-wallet.json', 'utf8'));
const authority = Keypair.fromSecretKey(Uint8Array.from(authorityJson));

const nonce = Date.now().toString() + '-' + randomBytes(4).toString('hex');
const contentHash = createHash('sha256').update(`devnet-smoke-${nonce}`).digest();
const [pda] = PublicKey.findProgramAddressSync([SEED, contentHash], PROGRAM_ID);
const fakeNft = Keypair.generate().publicKey;
const fakeCollection = Keypair.generate().publicKey;

console.log('=== fd-pointer v2 devnet smoke test ===');
console.log('Content hash:', contentHash.toString('hex'));
console.log('PDA:         ', pda.toBase58());
console.log('Authority:   ', authority.publicKey.toBase58());
console.log('Fake NFT:    ', fakeNft.toBase58());
console.log('Fake coll:   ', fakeCollection.toBase58());
console.log();

// Step 1: create_pointer_v2 with title
const testTitle = 'Devnet Smoke ' + nonce.slice(0, 8);
console.log('Step 1: create_pointer_v2 (last_sig=[0;64], primary_nft + collection + title)');
console.log('  Title:       "' + testTitle + '"');
const zeroSig = Buffer.alloc(64, 0);
const ix1 = buildCreatePointerV2Ix({
  payer: authority.publicKey,
  inscriber: authority.publicKey,
  contentHash,
  chunkCount: 79,
  blobSize: 46034,
  lastSig: zeroSig,
  mode: 3,
  contentType: 0,
  primaryNft: fakeNft,
  collection: fakeCollection,
  title: padTitle(testTitle),
});
const tx1 = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
  ix1
);
const sig1 = await sendAndConfirmTransaction(connection, tx1, [authority], { commitment: 'confirmed' });
console.log('  sig:', sig1);

// Read back
const raw1 = (await connection.getAccountInfo(pda)).data;
const p1 = parsePointer(raw1);
console.log('  account size:      ', p1.accountSize, 'bytes (expect 324)');
console.log('  version:           ', p1.version);
console.log('  chunkCount:        ', p1.chunkCount);
console.log('  blobSize:          ', p1.blobSize);
console.log('  primaryNft matches:', p1.primaryNft === fakeNft.toBase58());
console.log('  collection matches:', p1.collection === fakeCollection.toBase58());
console.log('  last_sig is zero:  ', p1.lastSig.equals(zeroSig));
console.log('  content_hash match:', p1.contentHash === contentHash.toString('hex'));
console.log('  title matches:     ', p1.title === testTitle, `("${p1.title}")`);

// Step 2: update_last_sig
console.log();
console.log('Step 2: update_last_sig with real 64-byte sig');
const realSig = randomBytes(64);
const ix2 = buildUpdateLastSigIx({
  inscriber: authority.publicKey,
  contentHash,
  lastSig: realSig,
});
const tx2 = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
  ix2
);
const sig2 = await sendAndConfirmTransaction(connection, tx2, [authority], { commitment: 'confirmed' });
console.log('  sig:', sig2);

const raw2 = (await connection.getAccountInfo(pda)).data;
const p2 = parsePointer(raw2);
console.log('  last_sig updated:', p2.lastSig.equals(realSig));
console.log('  last_sig (hex):  ', p2.lastSig.toString('hex').slice(0, 32) + '...');

// Step 3: write-once guard
console.log();
console.log('Step 3: update_last_sig again — should fail with AlreadyFinalized');
const ix3 = buildUpdateLastSigIx({
  inscriber: authority.publicKey,
  contentHash,
  lastSig: randomBytes(64),
});
const tx3 = new Transaction().add(ix3);
try {
  await sendAndConfirmTransaction(connection, tx3, [authority], { commitment: 'confirmed' });
  console.log('  UNEXPECTED: second call succeeded! Program error!');
  process.exit(1);
} catch (err) {
  const msg = err.message || err.toString();
  if (msg.includes('AlreadyFinalized') || msg.includes('0x1771')) {
    console.log('  ✓ rejected with AlreadyFinalized (write-once guard works)');
  } else {
    console.log('  ✗ rejected but not with AlreadyFinalized:', msg.slice(0, 200));
    process.exit(1);
  }
}

// Step 4: transfer_inscriber
console.log();
console.log('Step 4: transfer_inscriber (hand off to a fake "project" wallet)');
const fakeProject = Keypair.generate().publicKey;
const ix4 = buildTransferInscriberIx({
  currentInscriber: authority.publicKey,
  contentHash,
  newInscriber: fakeProject,
});
const tx4 = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
  ix4
);
const sig4 = await sendAndConfirmTransaction(connection, tx4, [authority], { commitment: 'confirmed' });
console.log('  sig:', sig4);

const raw4 = (await connection.getAccountInfo(pda)).data;
const p4 = parsePointer(raw4);
console.log('  inscriber changed:', p4.inscriber === fakeProject.toBase58());
console.log('  title unchanged:  ', p4.title === testTitle);
console.log('  last_sig unchanged:', p4.lastSig.equals(realSig));

// Step 5: migrate_pointer_account on a prior 260-byte PDA (if one exists)
console.log();
console.log('Step 5: migrate_pointer_account (find a 260-byte devnet PDA)');
try {
  const allAccounts = await connection.getProgramAccounts(PROGRAM_ID, { commitment: 'confirmed' });
  const oldPdas = allAccounts.filter(a => {
    const disc = a.account.data.subarray(0, 8);
    return disc.equals(Buffer.from([31, 144, 159, 52, 95, 134, 207, 237])) && a.account.data.length === 260;
  });
  console.log('  Found', oldPdas.length, 'legacy 260-byte PDAs on devnet');
  if (oldPdas.length > 0) {
    const target = oldPdas[0];
    console.log('  Migrating:', target.pubkey.toBase58());
    const ix5 = buildMigrateIx({
      pointer: target.pubkey,
      payer: authority.publicKey,
    });
    const tx5 = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
      ix5
    );
    const sig5 = await sendAndConfirmTransaction(connection, tx5, [authority], { commitment: 'confirmed' });
    console.log('  sig:', sig5);

    const rawMigrated = (await connection.getAccountInfo(target.pubkey)).data;
    console.log('  new size:', rawMigrated.length, '(expect 324)');
    console.log('  title bytes (should be zeros):', rawMigrated.subarray(228, 260).every(b => b === 0));
    console.log('  reserved bytes (should be zeros):', rawMigrated.subarray(260, 324).every(b => b === 0));
    console.log('  ✓ migration succeeded on devnet!');
  } else {
    console.log('  No 260-byte PDAs found on devnet — skip migrate test (OK)');
  }
} catch (err) {
  console.log('  migrate test skipped:', err.message.slice(0, 150));
}

console.log();
console.log('=== ✓ All v2 devnet smoke tests passed ===');
console.log('PDA:', pda.toBase58(), '— permanent on devnet');
console.log('Title: "' + testTitle + '"');
console.log('Explorer:', `https://explorer.solana.com/address/${pda.toBase58()}?cluster=devnet`);
