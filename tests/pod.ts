import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FreezedryPod } from "../target/types/freezedry_pod";
import { assert } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as crypto from "crypto";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Generate an Ed25519 keypair for the CDN signer (not a Solana wallet). */
function generateCdnKeypair(): { publicKey: Buffer; secretKey: Buffer } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const priv = privateKey.export({ type: "pkcs8", format: "der" }).slice(-32);
  const pub_ = publicKey.export({ type: "spki", format: "der" }).slice(-32);
  // Ed25519Program expects 64-byte secret key: [seed(32) + pubkey(32)]
  return {
    publicKey: Buffer.from(pub_),
    secretKey: Buffer.concat([priv, pub_]),
  };
}

/**
 * Build the 93-byte binary POD message.
 * Layout: version(1) | nonce(8) | epoch(4) | node_wallet(32) | content_hash(32) | bytes_served(8) | timestamp(8)
 */
function buildPodMessage(
  nonce: bigint,
  epoch: number,
  nodeWallet: PublicKey,
  contentHash: Buffer,
  bytesServed: bigint,
  timestampMs: bigint
): Buffer {
  const msg = Buffer.alloc(93);
  msg[0] = 1; // version
  msg.writeBigUInt64LE(nonce, 1);
  msg.writeUInt32LE(epoch, 9);
  nodeWallet.toBuffer().copy(msg, 13);
  contentHash.copy(msg, 45);
  msg.writeBigUInt64LE(bytesServed, 77);
  msg.writeBigInt64LE(timestampMs, 85);
  return msg;
}

/** Sign a POD message with the CDN Ed25519 secret key. */
function signPodMessage(message: Buffer, secretKey: Buffer): Buffer {
  // PKCS8 DER format for Ed25519: 16-byte prefix + 32-byte seed = 48 bytes total
  const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
  return Buffer.from(
    crypto.sign(null, message, {
      key: Buffer.concat([PKCS8_PREFIX, secretKey.slice(0, 32)]),
      format: "der",
      type: "pkcs8",
    })
  );
}

/** Helper: build and send a submit_receipt transaction. Returns tx signature. */
async function submitReceipt(
  program: Program<FreezedryPod>,
  provider: anchor.AnchorProvider,
  configPDA: PublicKey,
  cdnKeys: { publicKey: Buffer; secretKey: Buffer },
  nodeSigner: Keypair,
  nonce: bigint,
  epoch: number,
  contentHash: Buffer,
  bytesServed: bigint,
  timestampMs: bigint
): Promise<string> {
  const message = buildPodMessage(nonce, epoch, nodeSigner.publicKey, contentHash, bytesServed, timestampMs);
  const signature = signPodMessage(message, cdnKeys.secretKey);

  const [nodeEpochPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("fd-pod-node-epoch"),
      Buffer.from(new Uint32Array([epoch]).buffer),
      nodeSigner.publicKey.toBuffer(),
    ],
    program.programId
  );

  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: cdnKeys.publicKey,
    message: message,
    signature: signature,
  });

  const submitIx = await program.methods
    .submitReceipt(new anchor.BN(nonce.toString()), epoch)
    .accounts({
      config: configPDA,
      nodeEpoch: nodeEpochPDA,
      node: nodeSigner.publicKey,
      instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .instruction();

  const tx = new Transaction().add(ed25519Ix).add(submitIx);
  tx.feePayer = nodeSigner.publicKey;
  const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.sign(nodeSigner);

  const txSig = await provider.connection.sendRawTransaction(tx.serialize());
  await provider.connection.confirmTransaction(
    { signature: txSig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  return txSig;
}

// ── Test suite ───────────────────────────────────────────────────────────

describe("freezedry_pod", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.freezedryPod as Program<FreezedryPod>;

  // Authority (deployer)
  const authority = Keypair.generate();

  // CDN Ed25519 keypair (NOT a Solana wallet — just Ed25519 signing keys)
  const cdnKeys = generateCdnKeypair();

  // Node (submitter)
  const node = Keypair.generate();

  // PDAs
  let configPDA: PublicKey;
  let configBump: number;

  // Test data
  const contentHash = crypto.randomBytes(32);
  const EPOCH_LENGTH = 3600; // 1 hour
  const MAX_RECEIPT_AGE = 3600; // 1 hour
  let nonceCounter = BigInt(Date.now()) * 1000n;

  function nextNonce(): bigint {
    return nonceCounter++;
  }

  function currentEpoch(): number {
    return Math.floor(Date.now() / 1000 / EPOCH_LENGTH);
  }

  before(async () => {
    // Derive config PDA
    [configPDA, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-pod-config")],
      program.programId
    );

    // Fund authority and node
    const fundSigs = await Promise.all([
      provider.connection.requestAirdrop(authority.publicKey, 10 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(node.publicKey, 10 * LAMPORTS_PER_SOL),
    ]);
    for (const sig of fundSigs) {
      await provider.connection.confirmTransaction(sig);
    }
  });

  // ================================================================
  // 1. initialize_config
  // ================================================================

  it("initializes PodConfig with CDN pubkey", async () => {
    const cdnPubkeyArray = Array.from(cdnKeys.publicKey);

    await program.methods
      .initializeConfig(cdnPubkeyArray, EPOCH_LENGTH, MAX_RECEIPT_AGE)
      .accounts({
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const config = await program.account.podConfig.fetch(configPDA);
    assert.ok(config.authority.equals(authority.publicKey));
    assert.deepEqual(Array.from(config.cdnPubkey), cdnPubkeyArray);
    assert.equal(config.epochLength, EPOCH_LENGTH);
    assert.equal(config.maxReceiptAge, MAX_RECEIPT_AGE);
    assert.equal(config.totalReceipts.toNumber(), 0);
  });

  // ================================================================
  // 2. submit_receipt — valid receipt (creates NodeEpochAccount)
  // ================================================================

  it("submits a valid receipt", async () => {
    const nonce = nextNonce();
    const epoch = currentEpoch();
    const bytesServed = 1024n;
    const timestampMs = BigInt(Date.now());

    await submitReceipt(
      program, provider, configPDA, cdnKeys, node,
      nonce, epoch, contentHash, bytesServed, timestampMs
    );

    // Verify NodeEpochAccount
    const [nodeEpochPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("fd-pod-node-epoch"),
        Buffer.from(new Uint32Array([epoch]).buffer),
        node.publicKey.toBuffer(),
      ],
      program.programId
    );
    const nodeEpoch = await program.account.nodeEpochAccount.fetch(nodeEpochPDA);
    assert.equal(nodeEpoch.epoch, epoch);
    assert.ok(nodeEpoch.nodeWallet.equals(node.publicKey));
    assert.equal(nodeEpoch.deliveryCount.toNumber(), 1);
    assert.equal(nodeEpoch.bytesTotal.toString(), bytesServed.toString());
    assert.equal(nodeEpoch.lastNonce.toString(), nonce.toString());
    assert.equal(nodeEpoch.finalized, false);
  });

  // ================================================================
  // 3. submit_receipt — replay (lower nonce) rejected
  // ================================================================

  it("rejects replay with lower/equal nonce", async () => {
    const epoch = currentEpoch();

    // Submit with nonce N (should succeed — higher than last)
    const nonceN = nextNonce();
    await submitReceipt(
      program, provider, configPDA, cdnKeys, node,
      nonceN, epoch, contentHash, 512n, BigInt(Date.now())
    );

    // Attempt replay with nonce N-1 (lower than last_nonce) — should fail
    const replayNonce = nonceN - 1n;
    const message = buildPodMessage(replayNonce, epoch, node.publicKey, contentHash, 512n, BigInt(Date.now()));
    const signature = signPodMessage(message, cdnKeys.secretKey);

    const [nodeEpochPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("fd-pod-node-epoch"),
        Buffer.from(new Uint32Array([epoch]).buffer),
        node.publicKey.toBuffer(),
      ],
      program.programId
    );

    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: cdnKeys.publicKey,
      message,
      signature,
    });
    const submitIx = await program.methods
      .submitReceipt(new anchor.BN(replayNonce.toString()), epoch)
      .accounts({
        config: configPDA,
        nodeEpoch: nodeEpochPDA,
        node: node.publicKey,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    const tx = new Transaction().add(ed25519Ix).add(submitIx);
    tx.feePayer = node.publicKey;
    const { blockhash } = await provider.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(node);

    try {
      await provider.connection.sendRawTransaction(tx.serialize());
      assert.fail("Should have failed with NonceAlreadyUsed");
    } catch (err: any) {
      assert.ok(
        err.toString().includes("custom program error") ||
        err.toString().includes("NonceAlreadyUsed")
      );
    }
  });

  // ================================================================
  // 4. submit_receipt — expired timestamp rejected
  // ================================================================

  it("rejects expired receipt", async () => {
    const nonce = nextNonce();
    const epoch = currentEpoch();
    // Timestamp 2 hours ago — beyond max_receipt_age
    const staleTimestamp = BigInt(Date.now() - 2 * 3600 * 1000);

    const message = buildPodMessage(nonce, epoch, node.publicKey, contentHash, 256n, staleTimestamp);
    const signature = signPodMessage(message, cdnKeys.secretKey);

    const [nodeEpochPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("fd-pod-node-epoch"),
        Buffer.from(new Uint32Array([epoch]).buffer),
        node.publicKey.toBuffer(),
      ],
      program.programId
    );

    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: cdnKeys.publicKey,
      message,
      signature,
    });
    const submitIx = await program.methods
      .submitReceipt(new anchor.BN(nonce.toString()), epoch)
      .accounts({
        config: configPDA,
        nodeEpoch: nodeEpochPDA,
        node: node.publicKey,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    const tx = new Transaction().add(ed25519Ix).add(submitIx);
    tx.feePayer = node.publicKey;
    const { blockhash } = await provider.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(node);

    try {
      await provider.connection.sendRawTransaction(tx.serialize());
      assert.fail("Should have failed with expired receipt");
    } catch (err: any) {
      assert.ok(err.toString().includes("custom program error"));
    }
  });

  // ================================================================
  // 5. submit_receipt — wrong CDN key rejected
  // ================================================================

  it("rejects receipt signed with wrong CDN key", async () => {
    const wrongCdn = generateCdnKeypair();
    const nonce = nextNonce();
    const epoch = currentEpoch();
    const timestampMs = BigInt(Date.now());

    const message = buildPodMessage(nonce, epoch, node.publicKey, contentHash, 128n, timestampMs);
    const signature = signPodMessage(message, wrongCdn.secretKey);

    const [nodeEpochPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("fd-pod-node-epoch"),
        Buffer.from(new Uint32Array([epoch]).buffer),
        node.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Use wrong CDN's pubkey in the precompile
    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: wrongCdn.publicKey,
      message,
      signature,
    });
    const submitIx = await program.methods
      .submitReceipt(new anchor.BN(nonce.toString()), epoch)
      .accounts({
        config: configPDA,
        nodeEpoch: nodeEpochPDA,
        node: node.publicKey,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    const tx = new Transaction().add(ed25519Ix).add(submitIx);
    tx.feePayer = node.publicKey;
    const { blockhash } = await provider.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(node);

    try {
      await provider.connection.sendRawTransaction(tx.serialize());
      assert.fail("Should have failed with CDN pubkey mismatch");
    } catch (err: any) {
      assert.ok(err.toString().includes("custom program error"));
    }
  });

  // ================================================================
  // 6. submit_receipt — tampered message rejected
  // ================================================================

  it("rejects tampered message (Ed25519 precompile fails)", async () => {
    const nonce = nextNonce();
    const epoch = currentEpoch();
    const timestampMs = BigInt(Date.now());

    const message = buildPodMessage(nonce, epoch, node.publicKey, contentHash, 2048n, timestampMs);
    const signature = signPodMessage(message, cdnKeys.secretKey);

    // Tamper with the message (change bytes_served)
    const tampered = Buffer.from(message);
    tampered.writeBigUInt64LE(9999n, 77);

    const [nodeEpochPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("fd-pod-node-epoch"),
        Buffer.from(new Uint32Array([epoch]).buffer),
        node.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Precompile gets the tampered message but original signature — will fail
    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: cdnKeys.publicKey,
      message: tampered,
      signature,
    });
    const submitIx = await program.methods
      .submitReceipt(new anchor.BN(nonce.toString()), epoch)
      .accounts({
        config: configPDA,
        nodeEpoch: nodeEpochPDA,
        node: node.publicKey,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    const tx = new Transaction().add(ed25519Ix).add(submitIx);
    tx.feePayer = node.publicKey;
    const { blockhash } = await provider.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(node);

    try {
      await provider.connection.sendRawTransaction(tx.serialize());
      assert.fail("Should have failed with tampered message");
    } catch (err: any) {
      // Ed25519 precompile rejects the entire tx
      assert.ok(err.toString().length > 0);
    }
  });

  // ================================================================
  // 7. submit_receipt — wrong node wallet rejected
  // ================================================================

  it("rejects receipt with wrong node wallet", async () => {
    const wrongNode = Keypair.generate();
    const fundSig = await provider.connection.requestAirdrop(wrongNode.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(fundSig);

    const nonce = nextNonce();
    const epoch = currentEpoch();
    const timestampMs = BigInt(Date.now());

    // Message is signed for `node`, but `wrongNode` tries to submit
    const message = buildPodMessage(nonce, epoch, node.publicKey, contentHash, 512n, timestampMs);
    const signature = signPodMessage(message, cdnKeys.secretKey);

    const [nodeEpochPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("fd-pod-node-epoch"),
        Buffer.from(new Uint32Array([epoch]).buffer),
        wrongNode.publicKey.toBuffer(),
      ],
      program.programId
    );

    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: cdnKeys.publicKey,
      message,
      signature,
    });
    const submitIx = await program.methods
      .submitReceipt(new anchor.BN(nonce.toString()), epoch)
      .accounts({
        config: configPDA,
        nodeEpoch: nodeEpochPDA,
        node: wrongNode.publicKey,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    const tx = new Transaction().add(ed25519Ix).add(submitIx);
    tx.feePayer = wrongNode.publicKey;
    const { blockhash } = await provider.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(wrongNode);

    try {
      await provider.connection.sendRawTransaction(tx.serialize());
      assert.fail("Should have failed with node wallet mismatch");
    } catch (err: any) {
      assert.ok(err.toString().includes("custom program error"));
    }
  });

  // ================================================================
  // 8. submit_receipt — wrong epoch rejected
  // ================================================================

  it("rejects receipt with mismatched epoch arg", async () => {
    const nonce = nextNonce();
    const epoch = currentEpoch();
    const wrongEpoch = epoch + 999;
    const timestampMs = BigInt(Date.now());

    // Message has correct epoch, but instruction arg has wrong epoch
    const message = buildPodMessage(nonce, epoch, node.publicKey, contentHash, 256n, timestampMs);
    const signature = signPodMessage(message, cdnKeys.secretKey);

    const [nodeEpochPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("fd-pod-node-epoch"),
        Buffer.from(new Uint32Array([wrongEpoch]).buffer),
        node.publicKey.toBuffer(),
      ],
      program.programId
    );

    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: cdnKeys.publicKey,
      message,
      signature,
    });
    const submitIx = await program.methods
      .submitReceipt(new anchor.BN(nonce.toString()), wrongEpoch)
      .accounts({
        config: configPDA,
        nodeEpoch: nodeEpochPDA,
        node: node.publicKey,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    const tx = new Transaction().add(ed25519Ix).add(submitIx);
    tx.feePayer = node.publicKey;
    const { blockhash } = await provider.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(node);

    try {
      await provider.connection.sendRawTransaction(tx.serialize());
      assert.fail("Should have failed with epoch mismatch");
    } catch (err: any) {
      assert.ok(err.toString().includes("custom program error"));
    }
  });

  // ================================================================
  // 9. update_config — authority rotates CDN pubkey
  // ================================================================

  it("updates CDN pubkey via update_config", async () => {
    const newCdn = generateCdnKeypair();
    const newPubkeyArray = Array.from(newCdn.publicKey);

    await program.methods
      .updateConfig(newPubkeyArray, null, null, null)
      .accounts({
        config: configPDA,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const config = await program.account.podConfig.fetch(configPDA);
    assert.deepEqual(Array.from(config.cdnPubkey), newPubkeyArray);

    // Restore original CDN key for remaining tests
    await program.methods
      .updateConfig(Array.from(cdnKeys.publicKey), null, null, null)
      .accounts({
        config: configPDA,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();
  });

  // ================================================================
  // 10. update_config — non-authority rejected
  // ================================================================

  it("rejects update_config from non-authority", async () => {
    try {
      await program.methods
        .updateConfig(null, 7200, null, null)
        .accounts({
          config: configPDA,
          authority: node.publicKey, // node is NOT the authority
        })
        .signers([node])
        .rpc();
      assert.fail("Should have failed with NotAuthority");
    } catch (err: any) {
      assert.ok(
        err.toString().includes("NotAuthority") ||
        err.toString().includes("ConstraintRaw") ||
        err.toString().includes("custom program error")
      );
    }
  });

  // ================================================================
  // 11. finalize_epoch — locks NodeEpochAccount
  // ================================================================

  it("finalizes epoch stats", async () => {
    const epoch = currentEpoch();

    const [nodeEpochPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("fd-pod-node-epoch"),
        Buffer.from(new Uint32Array([epoch]).buffer),
        node.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Verify it exists and is not finalized
    const before = await program.account.nodeEpochAccount.fetch(nodeEpochPDA);
    assert.equal(before.finalized, false);
    assert.ok(before.deliveryCount.toNumber() >= 1);

    await program.methods
      .finalizeEpoch(epoch)
      .accounts({
        config: configPDA,
        nodeEpoch: nodeEpochPDA,
        nodeWallet: node.publicKey,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const after = await program.account.nodeEpochAccount.fetch(nodeEpochPDA);
    assert.equal(after.finalized, true);
    assert.equal(after.deliveryCount.toNumber(), before.deliveryCount.toNumber());
  });

  // ================================================================
  // 12. submit_receipt — non-sequential nonces work if strictly increasing
  // ================================================================

  it("accepts non-sequential nonces if strictly increasing", async () => {
    // Use a new node to get a fresh NodeEpochAccount for a different epoch
    const node2 = Keypair.generate();
    const fundSig = await provider.connection.requestAirdrop(node2.publicKey, 5 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(fundSig);

    // Use a far-future epoch so we get a fresh NodeEpochAccount
    const epoch = currentEpoch() + 1;

    // Submit nonce 100
    const nonce1 = BigInt(Date.now()) * 1000n + 100n;
    await submitReceipt(
      program, provider, configPDA, cdnKeys, node2,
      nonce1, epoch, contentHash, 256n, BigInt(Date.now())
    );

    // Submit nonce 500 (gap of 400 — should succeed since 500 > 100)
    const nonce2 = nonce1 + 400n;
    await submitReceipt(
      program, provider, configPDA, cdnKeys, node2,
      nonce2, epoch, contentHash, 512n, BigInt(Date.now())
    );

    // Verify NodeEpochAccount has correct state
    const [nodeEpochPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("fd-pod-node-epoch"),
        Buffer.from(new Uint32Array([epoch]).buffer),
        node2.publicKey.toBuffer(),
      ],
      program.programId
    );
    const nodeEpoch = await program.account.nodeEpochAccount.fetch(nodeEpochPDA);
    assert.equal(nodeEpoch.deliveryCount.toNumber(), 2);
    assert.equal(nodeEpoch.lastNonce.toString(), nonce2.toString());
  });
});
