#!/usr/bin/env node
// batch-migrate-pointers.mjs — Phase 1a.11.8
//
// Iterates every fd-pointer Pointer account owned by the program, finds
// accounts smaller than the current target size (8 + Pointer::INIT_SPACE =
// 324 bytes), and submits one migrate_pointer_account TX per account.
//
// Usage:
//   # Dry-run (default) — shows what would be migrated, sends nothing
//   node scripts/batch-migrate-pointers.mjs
//
//   # Actually send migration TXs (requires SIGNER_KEYPAIR env var)
//   node scripts/batch-migrate-pointers.mjs --execute
//
//   # Point at a specific RPC
//   node scripts/batch-migrate-pointers.mjs --rpc https://...
//
//   # Target specific cluster (affects default RPC)
//   node scripts/batch-migrate-pointers.mjs --cluster devnet
//
// Environment:
//   SIGNER_KEYPAIR   path to a JSON keypair file; signer pays rent delta +
//                    TX fees. Required for --execute. NOT required for dry-run.
//
// Cost expectation:
//   rent delta per migration ≈ 64 bytes × 6960 lamports/byte = 445,440 lamports
//   TX fee ≈ 5,000 lamports
//   per-migration total ≈ 450,440 lamports ≈ 0.00045 SOL
//   For 55 mainnet PDAs ≈ 0.0248 SOL ≈ $3.22 @ $130/SOL

import {
  Connection, PublicKey, Keypair,
  Transaction, TransactionInstruction, SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { readFileSync } from "fs";

const PROGRAM_ID = new PublicKey("FrzDrykT4XSp5BwdYdSJdLHbDVVPuquN2cDMJyVJ35iJ");
const POINTER_DISCRIMINATOR = Buffer.from([31, 144, 159, 52, 95, 134, 207, 237]);

// Target size is the v2 layout. Keep in sync with state.rs; if this ever
// drifts from Pointer::INIT_SPACE + 8, the Rust assertion catches it.
const V2_TARGET_SIZE = 324;

// Anchor IX discriminator for "migrate_pointer_account"
// = sha256("global:migrate_pointer_account")[..8]
// Pre-computed and verified against target/idl/fd_pointer.json.
function computeIxDiscriminator(name) {
  const hash = createHash("sha256").update(`global:${name}`).digest();
  return hash.subarray(0, 8);
}

function loadKeypair(path) {
  const raw = readFileSync(path, "utf8");
  const bytes = JSON.parse(raw);
  return Keypair.fromSecretKey(new Uint8Array(bytes));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const rpcArg = args.find((a, i) => args[i - 1] === "--rpc");
  const clusterArg = args.find((a, i) => args[i - 1] === "--cluster");
  const cluster = clusterArg || process.env.CLUSTER || "mainnet-beta";
  const defaultRpc = cluster === "devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com";
  const rpc = rpcArg || process.env.HELIUS_RPC_URL || defaultRpc;
  return { execute, rpc, cluster };
}

async function main() {
  const { execute, rpc, cluster } = parseArgs();

  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`  fd-pointer batch migrate — ${execute ? "LIVE" : "DRY-RUN"}`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`RPC:     ${rpc.replace(/api-key=[^&]+/, "api-key=***")}`);
  console.log(`Cluster: ${cluster}`);
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`Target:  ${V2_TARGET_SIZE} bytes`);
  console.log("");

  const connection = new Connection(rpc, { commitment: "confirmed" });

  // Load signer if --execute
  let signer = null;
  if (execute) {
    const kpPath = process.env.SIGNER_KEYPAIR;
    if (!kpPath) {
      console.error("ERROR: --execute requires SIGNER_KEYPAIR env var (path to JSON keypair)");
      process.exit(1);
    }
    signer = loadKeypair(kpPath);
    const balance = await connection.getBalance(signer.publicKey);
    console.log(`Signer:  ${signer.publicKey.toBase58()}`);
    console.log(`Balance: ${(balance / 1e9).toFixed(6)} SOL`);
    console.log("");
  }

  // 1. Fetch all program-owned accounts
  console.log("Fetching all Pointer accounts owned by program...");
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
  });
  console.log(`Found ${accounts.length} accounts total.`);

  // 2. Filter to (a) actual Pointer accounts by discriminator, (b) smaller than target
  const needsMigrate = [];
  let pointerCount = 0;
  let alreadyAtTargetCount = 0;
  let otherCount = 0;
  for (const { pubkey, account } of accounts) {
    if (account.data.length < 8) { otherCount++; continue; }
    const disc = account.data.subarray(0, 8);
    if (!disc.equals(POINTER_DISCRIMINATOR)) { otherCount++; continue; }
    pointerCount++;
    if (account.data.length < V2_TARGET_SIZE) {
      needsMigrate.push({ pubkey, currentSize: account.data.length, lamports: account.lamports });
    } else {
      alreadyAtTargetCount++;
    }
  }

  console.log(`  Pointer accounts:          ${pointerCount}`);
  console.log(`  Already at target size:    ${alreadyAtTargetCount}`);
  console.log(`  Candidates for migration:  ${needsMigrate.length}`);
  console.log(`  Other (non-Pointer):       ${otherCount}`);
  console.log("");

  if (needsMigrate.length === 0) {
    console.log("Nothing to migrate. Exiting.");
    process.exit(0);
  }

  // 3. Estimate cost
  const rentTargetMin = await connection.getMinimumBalanceForRentExemption(V2_TARGET_SIZE);
  let totalRentDelta = 0;
  for (const p of needsMigrate) {
    const delta = Math.max(0, rentTargetMin - p.lamports);
    totalRentDelta += delta;
    p.rentDelta = delta;
  }
  const estTxFees = needsMigrate.length * 5000;
  const estTotal = totalRentDelta + estTxFees;

  console.log(`Per-account target rent minimum: ${rentTargetMin.toLocaleString()} lamports`);
  console.log(`Total rent delta (all):         ${totalRentDelta.toLocaleString()} lamports`);
  console.log(`Estimated TX fees:              ${estTxFees.toLocaleString()} lamports`);
  console.log(`TOTAL ESTIMATED COST:           ${estTotal.toLocaleString()} lamports (${(estTotal / 1e9).toFixed(6)} SOL)`);
  console.log("");

  if (!execute) {
    console.log("Accounts that would be migrated:");
    for (const p of needsMigrate.slice(0, 20)) {
      console.log(`  ${p.pubkey.toBase58()}  (${p.currentSize} → ${V2_TARGET_SIZE}, delta ${p.rentDelta.toLocaleString()} lamports)`);
    }
    if (needsMigrate.length > 20) console.log(`  ... and ${needsMigrate.length - 20} more.`);
    console.log("");
    console.log("Dry-run complete. Re-run with --execute (and SIGNER_KEYPAIR env) to actually migrate.");
    process.exit(0);
  }

  // 4. Execute — send migrate_pointer_account TXs one at a time
  console.log(`Executing ${needsMigrate.length} migrations...`);
  console.log("");

  const ixDisc = computeIxDiscriminator("migrate_pointer_account");

  let successes = 0;
  let failures = 0;
  let totalSpent = 0;
  const failures_detail = [];

  for (let i = 0; i < needsMigrate.length; i++) {
    const p = needsMigrate[i];
    const progress = `[${i + 1}/${needsMigrate.length}]`;

    try {
      // Build the instruction: data = 8-byte discriminator (no args)
      const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: p.pubkey, isSigner: false, isWritable: true },
          { pubkey: signer.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(ixDisc),
      });

      const tx = new Transaction().add(ix);
      const balanceBefore = await connection.getBalance(signer.publicKey);

      const sig = await sendAndConfirmTransaction(connection, tx, [signer], {
        commitment: "confirmed",
        skipPreflight: false,
      });

      const balanceAfter = await connection.getBalance(signer.publicKey);
      const spent = balanceBefore - balanceAfter;
      totalSpent += spent;
      successes++;

      console.log(`${progress} ✓ ${p.pubkey.toBase58()}  spent ${spent.toLocaleString()} lamports  sig=${sig.slice(0, 20)}...`);
    } catch (err) {
      failures++;
      failures_detail.push({ pda: p.pubkey.toBase58(), err: err.message });
      console.error(`${progress} ✗ ${p.pubkey.toBase58()}  ${err.message.slice(0, 150)}`);
    }
  }

  console.log("");
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`  Migration complete`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`  Successes:     ${successes}`);
  console.log(`  Failures:      ${failures}`);
  console.log(`  Total spent:   ${totalSpent.toLocaleString()} lamports (${(totalSpent / 1e9).toFixed(6)} SOL)`);
  console.log("");

  if (failures > 0) {
    console.log("Failed migrations:");
    for (const f of failures_detail) {
      console.log(`  ${f.pda}: ${f.err}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(2);
});
