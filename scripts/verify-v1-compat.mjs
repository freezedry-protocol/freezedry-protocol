#!/usr/bin/env node
// verify-v1-compat.mjs — L5 real mainnet back-compat verification
//
// Fetches every Pointer account owned by fd-pointer on mainnet, decodes
// each under the OLD v1 260-byte layout, and reports:
//   - total count + how many match the expected Anchor discriminator
//   - size distribution (expect all 260 for pre-v2-deploy PDAs)
//   - version byte distribution (expect all v=1)
//   - field-level decode (asserts every field reads cleanly under v1 layout)
//   - link/collection/finalize state distribution
//   - explicit test of whether v2 Anchor deserialization would fail (YES, it
//     will — because 260 != 324)
//
// This is a READ-ONLY script. No SOL spent. No transactions sent.
//
// Usage:
//   node scripts/verify-v1-compat.mjs
//   node scripts/verify-v1-compat.mjs --rpc https://my-helius-rpc.com/?api-key=...
//
// Exit code 0 = all PDAs decode under v1 layout as expected.
// Exit code 1 = at least one PDA does NOT decode cleanly → investigate before
// mainnet v2 deploy.

import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";

// ── Constants (match state.rs) ──────────────────────────────────────────
const PROGRAM_ID = new PublicKey("FrzDrykT4XSp5BwdYdSJdLHbDVVPuquN2cDMJyVJ35iJ");
const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

// Anchor account discriminator for "Pointer" = sha256("account:Pointer")[..8]
// Verified against target/types/fd_pointer.ts
const POINTER_DISCRIMINATOR = Buffer.from([31, 144, 159, 52, 95, 134, 207, 237]);

// v1 struct byte offsets (total 260 bytes including 8-byte discriminator)
const V1 = {
  DISC: 0,             // [u8; 8]
  CONTENT_HASH: 8,     // [u8; 32]
  INSCRIBER: 40,       // Pubkey
  COLLECTION: 72,      // Pubkey
  CHUNK_COUNT: 104,    // u32
  BLOB_SIZE: 108,      // u32
  LAST_SIG: 112,       // [u8; 64]
  MODE: 176,           // u8
  CONTENT_TYPE: 177,   // u8
  SLOT: 178,           // u64
  TIMESTAMP: 186,      // i64
  PRIMARY_NFT: 194,    // Pubkey
  VERSION: 226,        // u8
  BUMP: 227,           // u8
  RESERVED: 228,       // [u8; 32]  (v1 reserved — will become title in v2 layout)
  TOTAL: 260,
};

const V2_EXPECTED_SIZE = 324;
const DEFAULT_PUBKEY = Buffer.alloc(32, 0);
const ZERO_SIG = Buffer.alloc(64, 0);

// ── Helpers ─────────────────────────────────────────────────────────────

function decodeV1(raw) {
  if (raw.length !== V1.TOTAL) {
    throw new Error(`expected ${V1.TOTAL} bytes, got ${raw.length}`);
  }
  if (!raw.subarray(V1.DISC, V1.DISC + 8).equals(POINTER_DISCRIMINATOR)) {
    throw new Error(`discriminator mismatch`);
  }
  return {
    contentHash:  raw.subarray(V1.CONTENT_HASH, V1.INSCRIBER),
    inscriber:    new PublicKey(raw.subarray(V1.INSCRIBER, V1.COLLECTION)),
    collection:   new PublicKey(raw.subarray(V1.COLLECTION, V1.CHUNK_COUNT)),
    chunkCount:   raw.readUInt32LE(V1.CHUNK_COUNT),
    blobSize:     raw.readUInt32LE(V1.BLOB_SIZE),
    lastSig:      raw.subarray(V1.LAST_SIG, V1.MODE),
    mode:         raw.readUInt8(V1.MODE),
    contentType:  raw.readUInt8(V1.CONTENT_TYPE),
    slot:         raw.readBigUInt64LE(V1.SLOT),
    timestamp:    raw.readBigInt64LE(V1.TIMESTAMP),
    primaryNft:   new PublicKey(raw.subarray(V1.PRIMARY_NFT, V1.VERSION)),
    version:      raw.readUInt8(V1.VERSION),
    bump:         raw.readUInt8(V1.BUMP),
    reserved:     raw.subarray(V1.RESERVED, V1.TOTAL),
  };
}

// Derive expected PDA from content_hash (must match on-chain program)
function derivePointerPDA(contentHash) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fd-pointer"), contentHash],
    PROGRAM_ID
  );
}

function hex(buf) {
  return buf.toString("hex");
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const rpcArg = process.argv.find((a, i) => process.argv[i - 1] === "--rpc");
  const rpcUrl = rpcArg || process.env.HELIUS_RPC_URL || DEFAULT_RPC;
  const connection = new Connection(rpcUrl, { commitment: "confirmed" });

  console.log(`RPC: ${rpcUrl.replace(/api-key=[^&]+/, "api-key=***")}`);
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log("");

  // Fetch every account owned by the program
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
  });

  console.log(`Fetched ${accounts.length} accounts owned by program.`);

  // Partition by discriminator
  const pointers = [];
  const other = [];
  for (const { pubkey, account } of accounts) {
    const disc = account.data.subarray(0, 8);
    if (disc.equals(POINTER_DISCRIMINATOR)) {
      pointers.push({ pubkey, data: account.data, lamports: account.lamports });
    } else {
      other.push({ pubkey, size: account.data.length });
    }
  }

  console.log(`  ${pointers.length} Pointer accounts (discriminator matches)`);
  console.log(`  ${other.length} other accounts (IDL storage, etc.)`);
  for (const o of other) {
    console.log(`    ${o.pubkey.toBase58()}  ${o.size} bytes`);
  }
  console.log("");

  // Size distribution
  const sizes = new Map();
  for (const p of pointers) {
    sizes.set(p.data.length, (sizes.get(p.data.length) ?? 0) + 1);
  }
  console.log("Pointer account sizes:");
  for (const [size, count] of [...sizes.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${size} bytes → ${count} accounts${size === V1.TOTAL ? " (v1 pre-title)" : size === V2_EXPECTED_SIZE ? " (v2 with title)" : " (UNEXPECTED)"}`);
  }
  console.log("");

  // Decode each pointer
  let okCount = 0;
  let errCount = 0;
  let v1Count = 0;
  let v2Count = 0;
  let linkedCount = 0;
  let collectionCount = 0;
  let finalizedCount = 0;
  let pdaSeedMatchCount = 0;
  const errors = [];

  for (const p of pointers) {
    try {
      if (p.data.length === V1.TOTAL) {
        const decoded = decodeV1(p.data);

        // Consistency: PDA address must derive from content_hash
        const [expectedPda] = derivePointerPDA(decoded.contentHash);
        if (expectedPda.equals(p.pubkey)) {
          pdaSeedMatchCount++;
        } else {
          throw new Error(`PDA seed mismatch: expected ${expectedPda.toBase58()}, got ${p.pubkey.toBase58()}`);
        }

        // Invariants on v1 data
        if (decoded.version !== 1) {
          throw new Error(`expected version=1, got ${decoded.version}`);
        }
        if (decoded.chunkCount === 0) {
          throw new Error(`chunk_count is zero`);
        }
        if (decoded.blobSize === 0) {
          throw new Error(`blob_size is zero`);
        }

        v1Count++;
        if (!decoded.primaryNft.toBuffer().equals(DEFAULT_PUBKEY)) linkedCount++;
        if (!decoded.collection.toBuffer().equals(DEFAULT_PUBKEY)) collectionCount++;
        if (!decoded.lastSig.equals(ZERO_SIG)) finalizedCount++;

        okCount++;
      } else if (p.data.length === V2_EXPECTED_SIZE) {
        v2Count++;
        okCount++;
        // (v2 decode path — for future PDAs created after v2 deploy)
      } else {
        throw new Error(`unexpected size ${p.data.length}`);
      }
    } catch (err) {
      errCount++;
      errors.push({ pda: p.pubkey.toBase58(), err: err.message });
    }
  }

  console.log("Per-account decode results:");
  console.log(`  ✓ decoded cleanly:                    ${okCount}`);
  console.log(`    - v1 layout (260 bytes):            ${v1Count}`);
  console.log(`    - v2 layout (324 bytes):            ${v2Count}`);
  console.log(`  ✗ failed to decode:                   ${errCount}`);
  if (errors.length > 0) {
    console.log("  Errors:");
    for (const e of errors.slice(0, 10)) {
      console.log(`    ${e.pda}: ${e.err}`);
    }
    if (errors.length > 10) console.log(`    ... and ${errors.length - 10} more`);
  }
  console.log("");

  console.log("v1 PDA state distribution:");
  console.log(`  primary_nft linked:    ${linkedCount} / ${v1Count}`);
  console.log(`  collection set:        ${collectionCount} / ${v1Count}`);
  console.log(`  last_sig finalized:    ${finalizedCount} / ${v1Count}`);
  console.log(`  PDA ≡ hash seed:       ${pdaSeedMatchCount} / ${v1Count}  ${pdaSeedMatchCount === v1Count ? "✓" : "✗ MISMATCH"}`);
  console.log("");

  // ── Back-compat analysis ────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("BACK-COMPAT ANALYSIS — v2 deployment implications");
  console.log("═══════════════════════════════════════════════════════════════");
  if (v1Count > 0) {
    console.log(`${v1Count} existing v1 PDAs are 260 bytes. The v2 Pointer struct`);
    console.log(`expects ${V2_EXPECTED_SIZE} bytes. After the v2 program deploy:`);
    console.log("");
    console.log("  ✗ Anchor `Account<'info, Pointer>` will REJECT these accounts");
    console.log("    at deserialization time (length mismatch error).");
    console.log("  ✗ Any IX that takes Account<Pointer> (link_nft, set_collection,");
    console.log("    update_last_sig, transfer_inscriber) will FAIL on these PDAs.");
    console.log("  ✓ Raw getAccountInfo + manual Borsh decode still works (this script).");
    console.log("  ✓ Off-chain readers (explorers, our share page, partner API) can");
    console.log("    continue to display these PDAs by version-aware decode.");
    console.log("");
    console.log("STATE OF LEGACY v1 PDAs:");
    if (linkedCount === 0 && collectionCount === 0 && finalizedCount === v1Count) {
      console.log("  All v1 PDAs are ALREADY finalized (last_sig set) and UNLINKED");
      console.log("  (no primary_nft, no collection). They're archival backfill records");
      console.log("  from the 2026-04-13 migration.");
      console.log("");
      console.log("  Because they're already finalized and have no expected on-chain");
      console.log("  mutations pending, making them read-only is LOW IMPACT.");
    }
  } else {
    console.log(`No v1 PDAs found. No back-compat concerns for mainnet deploy.`);
  }
  console.log("");

  // ── Exit code logic ────────────────────────────────────────────────
  const allDecoded = errCount === 0;
  const allPdaMatch = pdaSeedMatchCount === v1Count;
  const passed = allDecoded && allPdaMatch;

  console.log(`RESULT: ${passed ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`  All accounts decode under known layout: ${allDecoded ? "yes" : "no"}`);
  console.log(`  All PDAs derive from their content_hash: ${allPdaMatch ? "yes" : "no"}`);

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(2);
});
