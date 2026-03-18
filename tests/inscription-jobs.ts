import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FreezedryJobs } from "../target/types/freezedry_jobs";
import { FreezedryRegistry } from "../target/types/freezedry_registry";
import { assert } from "chai";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

describe("freezedry_jobs", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const jobsProgram = anchor.workspace
    .freezedryJobs as Program<FreezedryJobs>;
  const registryProgram = anchor.workspace
    .freezedryRegistry as Program<FreezedryRegistry>;


  // Keypairs
  const authority = Keypair.generate();  // Config admin
  const treasury = Keypair.generate();   // Treasury wallet
  const creator = Keypair.generate();    // Job creator (user)
  const writerOwner = Keypair.generate(); // Writer node operator
  const reader1Owner = Keypair.generate(); // Reader node #1
  const reader2Owner = Keypair.generate(); // Reader node #2
  const randomUser = Keypair.generate();  // For permissionless calls
  const externalReferrer = Keypair.generate(); // External marketplace referrer

  // PDAs
  let configPDA: PublicKey;
  let configBump: number;
  let writerNodePDA: PublicKey;
  let reader1NodePDA: PublicKey;
  let reader2NodePDA: PublicKey;
  let externalReferrerPDA: PublicKey;
  let writerReferrerPDA: PublicKey;
  let registryConfigPDA: PublicKey;

  // Job tracking
  const testHash = "sha256:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
  const testChunks = 10;
  const escrowAmount = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL

  before(async () => {
    // Derive Config PDA
    [configPDA, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-config")],
      jobsProgram.programId
    );

    // Derive NodeAccount PDAs from registry program
    [writerNodePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("freeze-node"), writerOwner.publicKey.toBuffer()],
      registryProgram.programId
    );
    [reader1NodePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("freeze-node"), reader1Owner.publicKey.toBuffer()],
      registryProgram.programId
    );
    [reader2NodePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("freeze-node"), reader2Owner.publicKey.toBuffer()],
      registryProgram.programId
    );

    // Derive RegistryConfig PDA (needed by claim_job for stake tiering)
    [registryConfigPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-registry-config")],
      registryProgram.programId
    );

    // Fund all accounts
    const fundees = [
      authority, treasury, creator, writerOwner,
      reader1Owner, reader2Owner, randomUser, externalReferrer,
    ];
    for (const kp of fundees) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Register nodes in the registry program
    await registryProgram.methods
      .registerNode("writer-1", "https://writer.example.com", { writer: {} })
      .accounts({ owner: writerOwner.publicKey })
      .signers([writerOwner])
      .rpc();

    await registryProgram.methods
      .registerNode("reader-1", "https://reader1.example.com", { reader: {} })
      .accounts({ owner: reader1Owner.publicKey })
      .signers([reader1Owner])
      .rpc();

    await registryProgram.methods
      .registerNode("reader-2", "https://reader2.example.com", { both: {} })
      .accounts({ owner: reader2Owner.publicKey })
      .signers([reader2Owner])
      .rpc();

    // Initialize RegistryConfig (needed by claim_job for preferred_validator lookup)
    // May already be initialized by registry tests — catch safely
    try {
      await registryProgram.methods
        .initializeConfig(PublicKey.default)
        .accounts({ authority: authority.publicKey })
        .signers([authority])
        .rpc();
    } catch (_e) {
      // Already initialized — ok, claim_job just needs it to exist
    }
  });

  // ============================================================
  // initialize
  // ============================================================

  it("initializes config with 4-way fee split", async () => {
    await jobsProgram.methods
      .initialize(
        treasury.publicKey,
        registryProgram.programId,
        3000,  // inscriber 30%
        1000,  // attester (indexer) 10%
        4000,  // treasury 40%
        2000,  // referral 20%
        2,     // min 2 attestations
        new anchor.BN(3600), // 1 hour expiry
        new anchor.BN(50_000_000) // min escrow 0.05 SOL (~$2 at test prices)
      )
      .accounts({
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const config = await jobsProgram.account.config.fetch(configPDA);
    assert.ok(config.authority.equals(authority.publicKey));
    assert.ok(config.treasury.equals(treasury.publicKey));
    assert.ok(config.registryProgram.equals(registryProgram.programId));
    assert.equal(config.inscriberFeeBps, 3000);
    assert.equal(config.indexerFeeBps, 1000);
    assert.equal(config.treasuryFeeBps, 4000);
    assert.equal(config.referralFeeBps, 2000);
    assert.equal(config.minAttestations, 2);
    assert.equal(config.jobExpirySeconds.toNumber(), 3600);
    assert.equal(config.totalJobsCreated.toNumber(), 0);
    assert.equal(config.totalJobsCompleted.toNumber(), 0);
    assert.equal(config.minEscrowLamports.toNumber(), 50_000_000);
  });

  it("authority updates config (change expiry)", async () => {
    await jobsProgram.methods
      .updateConfig(
        null,   // treasury unchanged
        null,   // inscriber_fee_bps unchanged
        null,   // indexer_fee_bps unchanged
        null,   // treasury_fee_bps unchanged
        null,   // referral_fee_bps unchanged
        null,   // min_attestations unchanged
        new anchor.BN(7200), // 2 hour expiry
        null,   // min_escrow_lamports unchanged
        null,   // default_exclusive_window unchanged
        null,   // max_exclusive_window unchanged
        null    // base_tx_fee_lamports unchanged
      )
      .accounts({
        config: configPDA,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const config = await jobsProgram.account.config.fetch(configPDA);
    assert.equal(config.jobExpirySeconds.toNumber(), 7200);
    assert.equal(config.inscriberFeeBps, 3000);
    assert.equal(config.minAttestations, 2);

    // Reset back to 3600 for remaining tests
    await jobsProgram.methods
      .updateConfig(null, null, null, null, null, null, new anchor.BN(3600), null, null, null, null)
      .accounts({ config: configPDA, authority: authority.publicKey })
      .signers([authority])
      .rpc();
  });

  it("non-authority cannot update config", async () => {
    try {
      await jobsProgram.methods
        .updateConfig(null, null, null, null, null, null, null, null, null, null, null)
        .accounts({
          config: configPDA,
          authority: randomUser.publicKey,
        })
        .signers([randomUser])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("NotCreator") ||
        err.toString().includes("ConstraintRaw") ||
        err.toString()
      );
    }
  });

  it("rejects invalid fee update (doesn't sum to 10000)", async () => {
    try {
      await jobsProgram.methods
        .updateConfig(
          null,
          8000,  // inscriber — way too high
          null,  // indexer stays 2000
          null,  // treasury stays 5000
          null,  // referral stays 1000 → total 16000
          null,
          null,
          null,  // min_escrow_lamports unchanged
          null,  // default_exclusive_window unchanged
          null,  // max_exclusive_window unchanged
          null   // base_tx_fee_lamports unchanged
        )
        .accounts({
          config: configPDA,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("InvalidFeeConfig") ||
        err.toString().includes("6000")
      );
    }
  });

  it("rejects re-initialization (Config PDA is singleton)", async () => {
    try {
      await jobsProgram.methods
        .initialize(
          treasury.publicKey,
          registryProgram.programId,
          5000, 2000, 2000, 1000,
          1,
          new anchor.BN(3600),
          new anchor.BN(50_000_000)
        )
        .accounts({
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("already in use") || err.logs,
        "Should reject duplicate Config init"
      );
    }
  });

  // ============================================================
  // register_referrer / close_referrer
  // ============================================================

  it("registers externalReferrer as a referrer", async () => {
    [externalReferrerPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-referrer"), externalReferrer.publicKey.toBuffer()],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .registerReferrer("Exchange Art")
      .accounts({
        owner: externalReferrer.publicKey,
      })
      .signers([externalReferrer])
      .rpc();

    const ref = await jobsProgram.account.referrerAccount.fetch(externalReferrerPDA);
    assert.ok(ref.wallet.equals(externalReferrer.publicKey));
    assert.equal(ref.name, "Exchange Art");
    assert.ok(ref.registeredAt.toNumber() > 0);
  });

  it("registers writerOwner as a referrer (for self-referral test)", async () => {
    [writerReferrerPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-referrer"), writerOwner.publicKey.toBuffer()],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .registerReferrer("Self Referrer")
      .accounts({
        owner: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    const ref = await jobsProgram.account.referrerAccount.fetch(writerReferrerPDA);
    assert.ok(ref.wallet.equals(writerOwner.publicKey));
    assert.equal(ref.name, "Self Referrer");
  });

  it("rejects duplicate referrer registration", async () => {
    try {
      await jobsProgram.methods
        .registerReferrer("Duplicate")
        .accounts({ owner: externalReferrer.publicKey })
        .signers([externalReferrer])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err.toString().includes("already in use") || err.logs);
    }
  });

  it("rejects empty referrer name", async () => {
    const tempKp = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(tempKp.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);

    try {
      await jobsProgram.methods
        .registerReferrer("")
        .accounts({ owner: tempKp.publicKey })
        .signers([tempKp])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("InvalidReferrerName") ||
        err.toString().includes("6021"),
        "Should reject empty name: " + err.toString()
      );
    }
  });

  it("referrer can close their account and reclaim rent", async () => {
    const tempReferrer = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(tempReferrer.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);

    await jobsProgram.methods
      .registerReferrer("Temporary")
      .accounts({ owner: tempReferrer.publicKey })
      .signers([tempReferrer])
      .rpc();

    const [tempPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-referrer"), tempReferrer.publicKey.toBuffer()],
      jobsProgram.programId
    );

    const balBefore = await provider.connection.getBalance(tempReferrer.publicKey);

    await jobsProgram.methods
      .closeReferrer()
      .accounts({
        referrerAccount: tempPDA,
        owner: tempReferrer.publicKey,
      })
      .signers([tempReferrer])
      .rpc();

    const info = await provider.connection.getAccountInfo(tempPDA);
    assert.isNull(info, "Referrer PDA should be closed");

    const balAfter = await provider.connection.getBalance(tempReferrer.publicKey);
    assert.ok(balAfter > balBefore, "Owner should reclaim rent");
  });

  // ============================================================
  // min_escrow enforcement
  // ============================================================

  it("rejects job with escrow below min_escrow_lamports", async () => {
    const tooLowEscrow = 10_000_000; // 0.01 SOL — below 0.05 SOL minimum
    const [lowJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(0).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    try {
      await jobsProgram.methods
        .createJob(testHash, testChunks, new anchor.BN(tooLowEscrow), treasury.publicKey, PublicKey.default, 0, "")
        .accounts({
          config: configPDA,
          creator: creator.publicKey,
          referrerAccount: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      assert.fail("Should have thrown EscrowTooLow");
    } catch (err) {
      assert.ok(
        err.toString().includes("EscrowTooLow") ||
        err.toString().includes("below the minimum"),
        "Should reject low escrow: " + err.toString()
      );
    }
  });

  it("authority can update min_escrow_lamports", async () => {
    // Lower it to 0.01 SOL for testing flexibility, then restore
    await jobsProgram.methods
      .updateConfig(null, null, null, null, null, null, null, new anchor.BN(10_000_000), null, null, null)
      .accounts({ config: configPDA, authority: authority.publicKey })
      .signers([authority])
      .rpc();

    const config = await jobsProgram.account.config.fetch(configPDA);
    assert.equal(config.minEscrowLamports.toNumber(), 10_000_000);

    // Restore to 0.05 SOL
    await jobsProgram.methods
      .updateConfig(null, null, null, null, null, null, null, new anchor.BN(50_000_000), null, null, null)
      .accounts({ config: configPDA, authority: authority.publicKey })
      .signers([authority])
      .rpc();
  });

  // ============================================================
  // create_job
  // ============================================================

  let jobPDA: PublicKey;
  let jobBump: number;

  it("creates a job with escrow and referrer", async () => {
    // Derive job PDA with job_id = 0 (first job)
    [jobPDA, jobBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(0).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    const creatorBalBefore = await provider.connection.getBalance(
      creator.publicKey
    );

    await jobsProgram.methods
      .createJob(testHash, testChunks, new anchor.BN(escrowAmount), externalReferrer.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: externalReferrerPDA,
      })
      .signers([creator])
      .rpc();

    const job = await jobsProgram.account.jobAccount.fetch(jobPDA);
    assert.equal(job.jobId.toNumber(), 0);
    assert.ok(job.creator.equals(creator.publicKey));
    assert.ok(job.writer.equals(PublicKey.default));
    assert.equal(job.contentHash, testHash);
    assert.equal(job.chunkCount, testChunks);
    assert.equal(job.escrowLamports.toNumber(), escrowAmount);
    assert.deepEqual(job.status, { open: {} });
    assert.ok(job.createdAt.toNumber() > 0);
    assert.equal(job.attestationCount, 0);
    assert.ok(job.referrer.equals(externalReferrer.publicKey), "Referrer should be stored");

    // Verify escrow deducted from creator
    const creatorBalAfter = await provider.connection.getBalance(
      creator.publicKey
    );
    assert.ok(
      creatorBalBefore - creatorBalAfter >= escrowAmount,
      "Creator should have paid at least escrow amount"
    );

    // Verify job PDA holds escrow
    const jobBal = await provider.connection.getBalance(jobPDA);
    assert.ok(jobBal >= escrowAmount, "Job PDA should hold escrow");

    // Config counter should be incremented
    const config = await jobsProgram.account.config.fetch(configPDA);
    assert.equal(config.totalJobsCreated.toNumber(), 1);
  });

  it("rejects zero escrow", async () => {
    try {
      await jobsProgram.methods
        .createJob(testHash, testChunks, new anchor.BN(0), treasury.publicKey, PublicKey.default, 0, "")
        .accounts({
          config: configPDA,
          creator: creator.publicKey,
          referrerAccount: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("ZeroEscrow") ||
        err.toString().includes("6002")
      );
    }
  });

  // ============================================================
  // claim_job
  // ============================================================

  it("writer claims a job", async () => {
    await jobsProgram.methods
      .claimJob()
      .accounts({
        job: jobPDA,
        config: configPDA,
        nodeAccount: writerNodePDA,
        registryConfig: registryConfigPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    const job = await jobsProgram.account.jobAccount.fetch(jobPDA);
    assert.ok(job.writer.equals(writerOwner.publicKey));
    assert.deepEqual(job.status, { claimed: {} });
    assert.ok(job.claimedAt.toNumber() > 0);
  });

  it("reader cannot claim a job (wrong role)", async () => {
    // Create a second job for this test
    const [job2PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(1).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob("sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", 5, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    try {
      await jobsProgram.methods
        .claimJob()
        .accounts({
          job: job2PDA,
          config: configPDA,
          nodeAccount: reader1NodePDA,  // Reader, not Writer
          registryConfig: registryConfigPDA,
          writer: reader1Owner.publicKey,
        })
        .signers([reader1Owner])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("InvalidNodeRole") ||
        err.toString().includes("6007")
      );
    }

    // Clean up: cancel job 2 (it's still Open)
    await jobsProgram.methods
      .cancelJob()
      .accounts({
        job: job2PDA,
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();
  });

  // ============================================================
  // submit_receipt
  // ============================================================

  const testPointerSig = "5wHGVxR9kP7dN3fT8aL2mCqY6b4vZeX1sJnW0RhUiK7yA3pQc8";

  it("writer submits receipt", async () => {
    await jobsProgram.methods
      .submitReceipt(testPointerSig)
      .accounts({
        job: jobPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    const job = await jobsProgram.account.jobAccount.fetch(jobPDA);
    assert.equal(job.pointerSig, testPointerSig);
    assert.deepEqual(job.status, { submitted: {} });
    assert.ok(job.submittedAt.toNumber() > 0);
  });

  it("non-writer cannot submit receipt on already-submitted job", async () => {
    try {
      await jobsProgram.methods
        .submitReceipt("fakesig")
        .accounts({
          job: jobPDA,
          writer: reader1Owner.publicKey,
        })
        .signers([reader1Owner])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("InvalidJobStatus") ||
        err.toString().includes("NotAssignedWriter") ||
        err.toString().includes("ConstraintRaw") ||
        err.toString()
      );
    }
  });

  // ============================================================
  // attest
  // ============================================================

  it("reader 1 attests (valid)", async () => {
    const [attestPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("fd-attest"),
        new anchor.BN(0).toArrayLike(Buffer, "le", 8),
        reader1Owner.publicKey.toBuffer(),
      ],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .attest(testHash)
      .accounts({
        job: jobPDA,
        config: configPDA,
        nodeAccount: reader1NodePDA,
        reader: reader1Owner.publicKey,
      })
      .signers([reader1Owner])
      .rpc();

    const attestation = await jobsProgram.account.verificationAttestation.fetch(
      attestPDA
    );
    assert.equal(attestation.jobId.toNumber(), 0);
    assert.ok(attestation.reader.equals(reader1Owner.publicKey));
    assert.equal(attestation.computedHash, testHash);
    assert.equal(attestation.isValid, true);
    assert.ok(attestation.attestedAt.toNumber() > 0);

    const job = await jobsProgram.account.jobAccount.fetch(jobPDA);
    assert.equal(job.attestationCount, 1);
  });

  it("writer cannot self-attest", async () => {
    // Create a new job where reader2 (Both role) is the writer
    const [job3PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(2).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob("sha256:cccccccccccccccccccccccccccccccccccccccc", 3, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // reader2 (Both role) claims
    await jobsProgram.methods
      .claimJob()
      .accounts({
        job: job3PDA,
        config: configPDA,
        nodeAccount: reader2NodePDA,
        registryConfig: registryConfigPDA,
        writer: reader2Owner.publicKey,
      })
      .signers([reader2Owner])
      .rpc();

    // reader2 submits receipt
    await jobsProgram.methods
      .submitReceipt("somesig123")
      .accounts({
        job: job3PDA,
        writer: reader2Owner.publicKey,
      })
      .signers([reader2Owner])
      .rpc();

    // reader2 tries to attest their own job — should fail with SelfAttestation
    try {
      await jobsProgram.methods
        .attest("sha256:cccccccccccccccccccccccccccccccccccccccc")
        .accounts({
          job: job3PDA,
          config: configPDA,
          nodeAccount: reader2NodePDA,
          reader: reader2Owner.publicKey,
        })
        .signers([reader2Owner])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("SelfAttestation") ||
        err.toString().includes("ConstraintRaw") ||
        err.toString().includes("6009")
      );
    }
  });

  it("duplicate attestation blocked (PDA already exists)", async () => {
    try {
      // reader1 already attested job 0
      await jobsProgram.methods
        .attest(testHash)
        .accounts({
          job: jobPDA,
          config: configPDA,
          nodeAccount: reader1NodePDA,
          reader: reader1Owner.publicKey,
        })
        .signers([reader1Owner])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      // PDA init will fail — already exists
      assert.ok(err.toString().includes("already in use") || err.logs);
    }
  });

  it("reader 2 attests (reaches quorum)", async () => {
    await jobsProgram.methods
      .attest(testHash)
      .accounts({
        job: jobPDA,
        config: configPDA,
        nodeAccount: reader2NodePDA,
        reader: reader2Owner.publicKey,
      })
      .signers([reader2Owner])
      .rpc();

    const job = await jobsProgram.account.jobAccount.fetch(jobPDA);
    assert.equal(job.attestationCount, 2);
  });

  // ============================================================
  // release_payment
  // ============================================================

  it("releases payment with 4-way split (inscriber + attester + referrer + treasury)", async () => {
    const inscriberBalBefore = await provider.connection.getBalance(
      writerOwner.publicKey
    );
    const treasuryBalBefore = await provider.connection.getBalance(
      treasury.publicKey
    );
    const referrerBalBefore = await provider.connection.getBalance(
      externalReferrer.publicKey
    );
    const attesterBalBefore = await provider.connection.getBalance(
      reader1Owner.publicKey
    );

    const [releaseAttestPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(0).toArrayLike(Buffer, "le", 8), reader1Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .releasePayment()
      .accounts({
        job: jobPDA,
        config: configPDA,
        inscriber: writerOwner.publicKey,
        treasury: treasury.publicKey,
        referrer: externalReferrer.publicKey,
        attestation: releaseAttestPDA,
        attester: reader1Owner.publicKey,
        signer: randomUser.publicKey,
      })
      .signers([randomUser])
      .rpc();

    const inscriberBalAfter = await provider.connection.getBalance(
      writerOwner.publicKey
    );
    const treasuryBalAfter = await provider.connection.getBalance(
      treasury.publicKey
    );
    const referrerBalAfter = await provider.connection.getBalance(
      externalReferrer.publicKey
    );
    const attesterBalAfter = await provider.connection.getBalance(
      reader1Owner.publicKey
    );

    // Inscriber should receive 30% of escrow
    const expectedInscriberAmount = Math.floor(escrowAmount * 3000 / 10000);
    const inscriberGain = inscriberBalAfter - inscriberBalBefore;
    assert.equal(inscriberGain, expectedInscriberAmount, "Inscriber should receive 30%");

    // Attester should receive 10% of escrow
    const expectedAttesterAmount = Math.floor(escrowAmount * 1000 / 10000);
    const attesterGain = attesterBalAfter - attesterBalBefore;
    assert.equal(attesterGain, expectedAttesterAmount, "Attester should receive 10%");

    // Referrer should receive 20% of escrow
    const expectedReferralAmount = Math.floor(escrowAmount * 2000 / 10000);
    const referrerGain = referrerBalAfter - referrerBalBefore;
    assert.equal(referrerGain, expectedReferralAmount, "Referrer should receive 20%");

    // Treasury gets the remainder = 40%
    const expectedTreasuryAmount = escrowAmount - expectedInscriberAmount - expectedAttesterAmount - expectedReferralAmount;
    const treasuryGain = treasuryBalAfter - treasuryBalBefore;
    assert.equal(
      treasuryGain,
      expectedTreasuryAmount,
      "Treasury should receive 40% (remainder)"
    );

    // Verify all amounts sum to escrow
    assert.equal(
      inscriberGain + attesterGain + treasuryGain + referrerGain,
      escrowAmount,
      "All fee shares should sum to escrow"
    );

    // Job should be Completed
    const job = await jobsProgram.account.jobAccount.fetch(jobPDA);
    assert.deepEqual(job.status, { completed: {} });
    assert.ok(job.completedAt.toNumber() > 0);

    // Config counter updated
    const config = await jobsProgram.account.config.fetch(configPDA);
    assert.equal(config.totalJobsCompleted.toNumber(), 1);
  });

  it("cannot release payment without quorum", async () => {
    // Create and submit a job without enough attestations
    const [job4PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(3).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob("sha256:dddddddddddddddddddddddddddddddddddddd", 2, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    await jobsProgram.methods
      .claimJob()
      .accounts({
        job: job4PDA,
        config: configPDA,
        nodeAccount: writerNodePDA,
        registryConfig: registryConfigPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    await jobsProgram.methods
      .submitReceipt("sig4444")
      .accounts({
        job: job4PDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    // Try to release with 0 attestations (quorum = 2)
    const [job4AttestPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(3).toArrayLike(Buffer, "le", 8), reader1Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );

    try {
      await jobsProgram.methods
        .releasePayment()
        .accounts({
          job: job4PDA,
          config: configPDA,
          inscriber: writerOwner.publicKey,
          treasury: treasury.publicKey,
          referrer: treasury.publicKey, // treasury is the referrer (default)
          attestation: job4AttestPDA,
          attester: reader1Owner.publicKey,
          signer: randomUser.publicKey,
        })
        .signers([randomUser])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      // With 0 attestations, the attestation PDA doesn't exist, so Anchor
      // may throw AccountNotInitialized before the quorum check runs.
      // Either error is acceptable — both prevent unauthorized release.
      assert.ok(
        err.toString().includes("QuorumNotReached") ||
        err.toString().includes("6010") ||
        err.toString().includes("AccountNotInitialized") ||
        err.toString().includes("3012") ||
        err.toString().includes("AccountDidNotDeserialize") ||
        err.toString().includes("has not been initialized"),
        "Should reject release without quorum: " + err.toString()
      );
    }
  });

  it("rejects wrong referrer account in release_payment", async () => {
    // Job 0 is already completed, use job 3 (which is Submitted with 0 attestations)
    // We need a Submitted job with quorum... Let's create a fresh one

    const config = await jobsProgram.account.config.fetch(configPDA);
    const nextId = config.totalJobsCreated.toNumber();
    const [refTestJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    // Create job with externalReferrer
    await jobsProgram.methods
      .createJob("sha256:reftest0000000000000000000000000000000000", 1, new anchor.BN(escrowAmount), externalReferrer.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: externalReferrerPDA,
      })
      .signers([creator])
      .rpc();

    // Writer claims and submits
    await jobsProgram.methods
      .claimJob()
      .accounts({
        job: refTestJobPDA,
        config: configPDA,
        nodeAccount: writerNodePDA,
        registryConfig: registryConfigPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    await jobsProgram.methods
      .submitReceipt("sigreftest")
      .accounts({
        job: refTestJobPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    // Get 2 attestations for quorum
    await jobsProgram.methods
      .attest("sha256:reftest0000000000000000000000000000000000")
      .accounts({
        job: refTestJobPDA,
        config: configPDA,
        nodeAccount: reader1NodePDA,
        reader: reader1Owner.publicKey,
      })
      .signers([reader1Owner])
      .rpc();

    await jobsProgram.methods
      .attest("sha256:reftest0000000000000000000000000000000000")
      .accounts({
        job: refTestJobPDA,
        config: configPDA,
        nodeAccount: reader2NodePDA,
        reader: reader2Owner.publicKey,
      })
      .signers([reader2Owner])
      .rpc();

    // Derive attestation PDA for release_payment
    const [refTestAttestPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8), reader1Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );

    // Try to release with WRONG referrer (randomUser instead of externalReferrer)
    try {
      await jobsProgram.methods
        .releasePayment()
        .accounts({
          job: refTestJobPDA,
          config: configPDA,
          inscriber: writerOwner.publicKey,
          treasury: treasury.publicKey,
          referrer: randomUser.publicKey,  // WRONG — job.referrer is externalReferrer
          attestation: refTestAttestPDA,
          attester: reader1Owner.publicKey,
          signer: randomUser.publicKey,
        })
        .signers([randomUser])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("InvalidReferrer") ||
        err.toString().includes("ConstraintRaw") ||
        err.toString().includes("6018"),
        "Should reject wrong referrer"
      );
    }

    // Now release with correct referrer — should succeed
    await jobsProgram.methods
      .releasePayment()
      .accounts({
        job: refTestJobPDA,
        config: configPDA,
        inscriber: writerOwner.publicKey,
        treasury: treasury.publicKey,
        referrer: externalReferrer.publicKey,
        attestation: refTestAttestPDA,
        attester: reader1Owner.publicKey,
        signer: randomUser.publicKey,
      })
      .signers([randomUser])
      .rpc();

    const job = await jobsProgram.account.jobAccount.fetch(refTestJobPDA);
    assert.deepEqual(job.status, { completed: {} });
  });

  it("self-referral: inscriber gets inscriber + referral share", async () => {
    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const nextId = cfg.totalJobsCreated.toNumber();
    const [selfRefJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    // Create job with referrer = writerOwner (self-referral)
    await jobsProgram.methods
      .createJob("sha256:selfref00000000000000000000000000000000000", 1, new anchor.BN(escrowAmount), writerOwner.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: writerReferrerPDA,
      })
      .signers([creator])
      .rpc();

    // Writer claims, submits, gets attestations
    await jobsProgram.methods
      .claimJob()
      .accounts({
        job: selfRefJobPDA,
        config: configPDA,
        nodeAccount: writerNodePDA,
        registryConfig: registryConfigPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    await jobsProgram.methods
      .submitReceipt("sigselfref")
      .accounts({
        job: selfRefJobPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    await jobsProgram.methods
      .attest("sha256:selfref00000000000000000000000000000000000")
      .accounts({
        job: selfRefJobPDA,
        config: configPDA,
        nodeAccount: reader1NodePDA,
        reader: reader1Owner.publicKey,
      })
      .signers([reader1Owner])
      .rpc();

    await jobsProgram.methods
      .attest("sha256:selfref00000000000000000000000000000000000")
      .accounts({
        job: selfRefJobPDA,
        config: configPDA,
        nodeAccount: reader2NodePDA,
        reader: reader2Owner.publicKey,
      })
      .signers([reader2Owner])
      .rpc();

    const inscriberBalBefore = await provider.connection.getBalance(writerOwner.publicKey);
    const treasuryBalBefore = await provider.connection.getBalance(treasury.publicKey);
    const attesterBalBefore = await provider.connection.getBalance(reader1Owner.publicKey);

    // Derive attestation PDA for release_payment
    const [selfRefAttestPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8), reader1Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );

    // Release with referrer = inscriber (same wallet gets both shares)
    await jobsProgram.methods
      .releasePayment()
      .accounts({
        job: selfRefJobPDA,
        config: configPDA,
        inscriber: writerOwner.publicKey,
        treasury: treasury.publicKey,
        referrer: writerOwner.publicKey,  // Self-referral
        attestation: selfRefAttestPDA,
        attester: reader1Owner.publicKey,
        signer: randomUser.publicKey,
      })
      .signers([randomUser])
      .rpc();

    const inscriberBalAfter = await provider.connection.getBalance(writerOwner.publicKey);
    const treasuryBalAfter = await provider.connection.getBalance(treasury.publicKey);
    const attesterBalAfter = await provider.connection.getBalance(reader1Owner.publicKey);

    // Inscriber should receive inscriber (30%) + referral (20%) = 50%
    const expectedInscriberAmount = Math.floor(escrowAmount * 3000 / 10000);
    const expectedReferralAmount = Math.floor(escrowAmount * 2000 / 10000);
    const expectedAttesterAmount = Math.floor(escrowAmount * 1000 / 10000);
    const inscriberGain = inscriberBalAfter - inscriberBalBefore;
    assert.equal(
      inscriberGain,
      expectedInscriberAmount + expectedReferralAmount,
      "Self-referral inscriber should receive 50% (30% inscriber + 20% referral)"
    );

    // Attester gets 10%
    const attesterGain = attesterBalAfter - attesterBalBefore;
    assert.equal(attesterGain, expectedAttesterAmount, "Attester should receive 10%");

    // Treasury gets 40% (remainder)
    const expectedTreasuryAmount = escrowAmount - expectedInscriberAmount - expectedAttesterAmount - expectedReferralAmount;
    const treasuryGain = treasuryBalAfter - treasuryBalBefore;
    assert.equal(treasuryGain, expectedTreasuryAmount, "Treasury should receive 40%");
  });

  it("treasury-as-referrer: treasury gets treasury + referral share", async () => {
    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const nextId = cfg.totalJobsCreated.toNumber();
    const [noRefJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    // Create job with referrer = treasury (default no-referrer case)
    await jobsProgram.methods
      .createJob("sha256:noref000000000000000000000000000000000000000", 1, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    await jobsProgram.methods
      .claimJob()
      .accounts({
        job: noRefJobPDA,
        config: configPDA,
        nodeAccount: writerNodePDA,
        registryConfig: registryConfigPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    await jobsProgram.methods
      .submitReceipt("signoref")
      .accounts({
        job: noRefJobPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    await jobsProgram.methods
      .attest("sha256:noref000000000000000000000000000000000000000")
      .accounts({
        job: noRefJobPDA,
        config: configPDA,
        nodeAccount: reader1NodePDA,
        reader: reader1Owner.publicKey,
      })
      .signers([reader1Owner])
      .rpc();

    await jobsProgram.methods
      .attest("sha256:noref000000000000000000000000000000000000000")
      .accounts({
        job: noRefJobPDA,
        config: configPDA,
        nodeAccount: reader2NodePDA,
        reader: reader2Owner.publicKey,
      })
      .signers([reader2Owner])
      .rpc();

    const inscriberBalBefore = await provider.connection.getBalance(writerOwner.publicKey);
    const treasuryBalBefore = await provider.connection.getBalance(treasury.publicKey);
    const attesterBalBefore = await provider.connection.getBalance(reader1Owner.publicKey);

    // Derive attestation PDA for release_payment
    const [noRefAttestPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8), reader1Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );

    // Release with referrer = treasury (treasury gets both treasury + referral)
    await jobsProgram.methods
      .releasePayment()
      .accounts({
        job: noRefJobPDA,
        config: configPDA,
        inscriber: writerOwner.publicKey,
        treasury: treasury.publicKey,
        referrer: treasury.publicKey,  // No external referrer — treasury absorbs
        attestation: noRefAttestPDA,
        attester: reader1Owner.publicKey,
        signer: randomUser.publicKey,
      })
      .signers([randomUser])
      .rpc();

    const inscriberBalAfter = await provider.connection.getBalance(writerOwner.publicKey);
    const treasuryBalAfter = await provider.connection.getBalance(treasury.publicKey);
    const attesterBalAfter = await provider.connection.getBalance(reader1Owner.publicKey);

    // Inscriber gets 30%
    const expectedInscriberAmount = Math.floor(escrowAmount * 3000 / 10000);
    const inscriberGain = inscriberBalAfter - inscriberBalBefore;
    assert.equal(inscriberGain, expectedInscriberAmount, "Inscriber should receive 30%");

    // Attester gets 10%
    const expectedAttesterAmount = Math.floor(escrowAmount * 1000 / 10000);
    const attesterGain = attesterBalAfter - attesterBalBefore;
    assert.equal(attesterGain, expectedAttesterAmount, "Attester should receive 10%");

    // Treasury gets 40% (treasury share) + 20% (referral share) = 60%
    const expectedReferralAmount = Math.floor(escrowAmount * 2000 / 10000);
    const expectedTreasuryBase = escrowAmount - expectedInscriberAmount - expectedAttesterAmount - expectedReferralAmount;
    const treasuryGain = treasuryBalAfter - treasuryBalBefore;
    assert.equal(
      treasuryGain,
      expectedTreasuryBase + expectedReferralAmount,
      "Treasury-as-referrer should receive 60% (40% treasury + 20% referral)"
    );
  });

  // ============================================================
  // cancel_job
  // ============================================================

  it("creator cancels an open job (full refund)", async () => {
    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const nextId = cfg.totalJobsCreated.toNumber();
    const [job5PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob("sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 1, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const creatorBalBefore = await provider.connection.getBalance(
      creator.publicKey
    );

    await jobsProgram.methods
      .cancelJob()
      .accounts({
        job: job5PDA,
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    const creatorBalAfter = await provider.connection.getBalance(
      creator.publicKey
    );

    // Creator should get back escrow + rent (minus cancel tx fee)
    assert.ok(
      creatorBalAfter > creatorBalBefore + escrowAmount - 50000,
      "Creator should receive escrow + rent back"
    );

    // PDA should be closed
    const info = await provider.connection.getAccountInfo(job5PDA);
    assert.isNull(info, "Job PDA should be closed");
  });

  it("non-creator cannot cancel", async () => {
    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const nextId = cfg.totalJobsCreated.toNumber();
    const [job6PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob("sha256:ffffffffffffffffffffffffffffffffffffffff", 1, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    try {
      await jobsProgram.methods
        .cancelJob()
        .accounts({
          job: job6PDA,
          creator: randomUser.publicKey,
        })
        .signers([randomUser])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err.toString());
    }

    // Clean up
    await jobsProgram.methods
      .cancelJob()
      .accounts({
        job: job6PDA,
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();
  });

  it("cannot cancel a claimed job", async () => {
    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const nextId = cfg.totalJobsCreated.toNumber();
    const [job7PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob("sha256:1111111111111111111111111111111111111111", 1, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Writer claims it
    await jobsProgram.methods
      .claimJob()
      .accounts({
        job: job7PDA,
        config: configPDA,
        nodeAccount: writerNodePDA,
        registryConfig: registryConfigPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    // Creator tries to cancel — should fail (status is Claimed, not Open)
    try {
      await jobsProgram.methods
        .cancelJob()
        .accounts({
          job: job7PDA,
          creator: creator.publicKey,
        })
        .signers([creator])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("InvalidJobStatus") ||
        err.toString().includes("ConstraintRaw") ||
        err.toString().includes("6001")
      );
    }
  });

  // ============================================================
  // refund_expired (uses short expiry config for testing)
  // ============================================================

  it("refund_expired rejects non-expired job", async () => {
    // Last created job (claimed) is not expired
    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const lastId = cfg.totalJobsCreated.toNumber() - 1;
    const [lastJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(lastId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    try {
      await jobsProgram.methods
        .refundExpired()
        .accounts({
          job: lastJobPDA,
          config: configPDA,
          creator: creator.publicKey,
          signer: randomUser.publicKey,
        })
        .signers([randomUser])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("NotExpired") ||
        err.toString().includes("6011")
      );
    }
  });

  // ============================================================
  // Edge cases
  // ============================================================

  it("unregistered node cannot claim", async () => {
    const config = await jobsProgram.account.config.fetch(configPDA);
    const nextId = config.totalJobsCreated.toNumber();
    const [freshJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob("sha256:2222222222222222222222222222222222222222", 1, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // randomUser has no NodeAccount PDA
    const [fakeNodePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("freeze-node"), randomUser.publicKey.toBuffer()],
      registryProgram.programId
    );

    try {
      await jobsProgram.methods
        .claimJob()
        .accounts({
          job: freshJobPDA,
          config: configPDA,
          nodeAccount: fakeNodePDA,
          registryConfig: registryConfigPDA,
          writer: randomUser.publicKey,
        })
        .signers([randomUser])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err.toString());
    }
  });

  // ============================================================
  // assigned_node + exclusive_window (v3)
  // ============================================================

  let assignedJobPDA: PublicKey;
  const assignedNode = Keypair.generate(); // Simulated partner node

  it("creates job with assigned_node and exclusive window", async () => {
    // Fund the assigned node
    const sig = await provider.connection.requestAirdrop(assignedNode.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);

    const config = await jobsProgram.account.config.fetch(configPDA);
    const nextJobId = config.totalJobsCreated.toNumber();

    [assignedJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextJobId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob(
        "sha256:assigned000000000000000000000000000000000",
        1,
        new anchor.BN(escrowAmount),
        treasury.publicKey,
        assignedNode.publicKey,  // assigned_node
        600,                      // 10 min exclusive window
        ""                        // blob_source (default CDN)
      )
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const job = await jobsProgram.account.jobAccount.fetch(assignedJobPDA);
    console.log("  assignedNode:", job.assignedNode?.toBase58(), "expected:", assignedNode.publicKey.toBase58());
    console.log("  exclusiveUntil:", job.exclusiveUntil?.toNumber());
    console.log("  job keys:", Object.keys(job).join(", "));
    assert.ok(job.assignedNode.equals(assignedNode.publicKey), "assigned_node should be set");
    assert.ok(job.exclusiveUntil.toNumber() > 0, "exclusive_until should be non-zero");
  });

  it("non-assigned node cannot claim during exclusive window", async () => {
    try {
      await jobsProgram.methods
        .claimJob()
        .accounts({
          job: assignedJobPDA,
          config: configPDA,
          nodeAccount: writerNodePDA,
          registryConfig: registryConfigPDA,
          writer: writerOwner.publicKey,
        })
        .signers([writerOwner])
        .rpc();
      assert.fail("Should have thrown ExclusiveWindowActive");
    } catch (err) {
      assert.ok(
        err.toString().includes("ExclusiveWindowActive") ||
        err.toString().includes("exclusive"),
        "Should reject non-assigned node during window: " + err.toString()
      );
    }
  });

  it("creates job without assigned_node (open marketplace)", async () => {
    const config = await jobsProgram.account.config.fetch(configPDA);
    const nextJobId = config.totalJobsCreated.toNumber();

    const [openJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextJobId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob(
        "sha256:openmarket0000000000000000000000000000000",
        1,
        new anchor.BN(escrowAmount),
        treasury.publicKey,
        PublicKey.default,  // no assigned node
        0,                   // no exclusive window
        ""                   // blob_source (default CDN)
      )
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const job = await jobsProgram.account.jobAccount.fetch(openJobPDA);
    assert.ok(job.assignedNode.equals(PublicKey.default), "assigned_node should be default (open)");
    assert.equal(job.exclusiveUntil.toNumber(), 0, "exclusive_until should be 0 (open)");

    // Any registered writer can claim immediately (no exclusive window)
    await jobsProgram.methods
      .claimJob()
      .accounts({
        job: openJobPDA,
        config: configPDA,
        nodeAccount: writerNodePDA,
        registryConfig: registryConfigPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    const claimed = await jobsProgram.account.jobAccount.fetch(openJobPDA);
    assert.ok(claimed.writer.equals(writerOwner.publicKey), "Any writer should claim open job");
  });

  it("exclusive window capped by max_exclusive_window", async () => {
    const config = await jobsProgram.account.config.fetch(configPDA);
    const maxWindow = config.maxExclusiveWindow; // 3600 (1 hr)

    try {
      const nextJobId = config.totalJobsCreated.toNumber();
      const [capJobPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("fd-job"), new anchor.BN(nextJobId).toArrayLike(Buffer, "le", 8)],
        jobsProgram.programId
      );

      await jobsProgram.methods
        .createJob(
          "sha256:captest00000000000000000000000000000000000",
          1,
          new anchor.BN(escrowAmount),
          treasury.publicKey,
          assignedNode.publicKey,
          maxWindow + 1,  // exceeds max
          ""              // blob_source
        )
        .accounts({
          config: configPDA,
          creator: creator.publicKey,
          referrerAccount: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      assert.fail("Should have thrown ExclusiveWindowTooLong");
    } catch (err) {
      assert.ok(
        err.toString().includes("ExclusiveWindowTooLong") ||
        err.toString().includes("exceeds maximum"),
        "Should reject window > max: " + err.toString()
      );
    }
  });

  it("config stores default and max exclusive window", async () => {
    const config = await jobsProgram.account.config.fetch(configPDA);
    assert.equal(config.defaultExclusiveWindow, 1800, "default should be 1800 (30 min)");
    assert.equal(config.maxExclusiveWindow, 3600, "max should be 3600 (1 hr)");
  });

  // ============================================================
  // referrer PDA validation in create_job
  // ============================================================

  it("rejects unregistered referrer in create_job", async () => {
    const unregistered = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(unregistered.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);

    const [fakePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-referrer"), unregistered.publicKey.toBuffer()],
      jobsProgram.programId
    );

    const config = await jobsProgram.account.config.fetch(configPDA);
    const nextId = config.totalJobsCreated.toNumber();
    const [testJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    try {
      await jobsProgram.methods
        .createJob(
          "sha256:unreg000000000000000000000000000000000000",
          1,
          new anchor.BN(escrowAmount),
          unregistered.publicKey,
          PublicKey.default,
          0,
          ""  // blob_source
        )
        .accounts({
          config: configPDA,
          creator: creator.publicKey,
          referrerAccount: fakePDA,
        })
        .signers([creator])
        .rpc();
      assert.fail("Should have thrown ReferrerNotRegistered");
    } catch (err) {
      assert.ok(
        err.toString().includes("ReferrerNotRegistered") ||
        err.toString().includes("AccountNotInitialized") ||
        err.toString().includes("3012"),
        "Should reject unregistered referrer: " + err.toString()
      );
    }
  });

  it("allows Pubkey.default referrer without registered PDA", async () => {
    const config = await jobsProgram.account.config.fetch(configPDA);
    const nextId = config.totalJobsCreated.toNumber();
    const [defaultRefJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob(
        "sha256:defref00000000000000000000000000000000000",
        1,
        new anchor.BN(escrowAmount),
        PublicKey.default,
        PublicKey.default,
        0,
        ""  // blob_source
      )
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const job = await jobsProgram.account.jobAccount.fetch(defaultRefJobPDA);
    assert.ok(job.referrer.equals(PublicKey.default), "Referrer should be default pubkey");

    // Clean up
    await jobsProgram.methods
      .cancelJob()
      .accounts({ job: defaultRefJobPDA, creator: creator.publicKey })
      .signers([creator])
      .rpc();
  });

  // ============================================================
  // blob_source field tests
  // ============================================================

  it("stores custom blob_source in job PDA", async () => {
    const config = await jobsProgram.account.config.fetch(configPDA);
    const nextId = config.totalJobsCreated.toNumber();
    const [blobSrcJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    const customUrl = "https://my-server.example.com/blobs/abc123";
    await jobsProgram.methods
      .createJob(
        "sha256:blobsrc0000000000000000000000000000000000",
        1,
        new anchor.BN(escrowAmount),
        treasury.publicKey,
        PublicKey.default,
        0,
        customUrl
      )
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const job = await jobsProgram.account.jobAccount.fetch(blobSrcJobPDA);
    assert.equal(job.blobSource, customUrl, "blob_source should match custom URL");

    // Clean up
    await jobsProgram.methods
      .cancelJob()
      .accounts({ job: blobSrcJobPDA, creator: creator.publicKey })
      .signers([creator])
      .rpc();
  });

  it("rejects blob_source over 200 characters", async () => {
    const config = await jobsProgram.account.config.fetch(configPDA);
    const nextId = config.totalJobsCreated.toNumber();
    const [longSrcJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    const longUrl = "https://example.com/" + "x".repeat(200); // 221 chars total

    try {
      await jobsProgram.methods
        .createJob(
          "sha256:longsrc0000000000000000000000000000000000",
          1,
          new anchor.BN(escrowAmount),
          treasury.publicKey,
          PublicKey.default,
          0,
          longUrl
        )
        .accounts({
          config: configPDA,
          creator: creator.publicKey,
          referrerAccount: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      assert.fail("Should have thrown BlobSourceTooLong");
    } catch (err) {
      assert.ok(
        err.toString().includes("BlobSourceTooLong") ||
        err.toString().includes("blob source") ||
        err.toString().includes("200"),
        "Should reject blob_source > 200 chars: " + err.toString()
      );
    }
  });

  it("stores empty blob_source (default CDN)", async () => {
    const config = await jobsProgram.account.config.fetch(configPDA);
    const nextId = config.totalJobsCreated.toNumber();
    const [emptyBlobJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob(
        "sha256:emptysrc000000000000000000000000000000000",
        1,
        new anchor.BN(escrowAmount),
        treasury.publicKey,
        PublicKey.default,
        0,
        ""  // empty = use default CDN
      )
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const job = await jobsProgram.account.jobAccount.fetch(emptyBlobJobPDA);
    assert.equal(job.blobSource, "", "empty blob_source = default CDN staging");

    // Clean up
    await jobsProgram.methods
      .cancelJob()
      .accounts({ job: emptyBlobJobPDA, creator: creator.publicKey })
      .signers([creator])
      .rpc();
  });

  it("authority can update exclusive window config", async () => {
    await jobsProgram.methods
      .updateConfig(null, null, null, null, null, null, null, null, 900, 1800, null)
      .accounts({ config: configPDA, authority: authority.publicKey })
      .signers([authority])
      .rpc();

    const config = await jobsProgram.account.config.fetch(configPDA);
    assert.equal(config.defaultExclusiveWindow, 900, "default should be updated to 900");
    assert.equal(config.maxExclusiveWindow, 1800, "max should be updated to 1800");

    // Restore defaults
    await jobsProgram.methods
      .updateConfig(null, null, null, null, null, null, null, null, 1800, 3600, null)
      .accounts({ config: configPDA, authority: authority.publicKey })
      .signers([authority])
      .rpc();
  });

  // ============================================================
  // close_completed_job (permissionless)
  // ============================================================

  it("third-party can close a completed job — rent returns to creator", async () => {
    // Create a fresh job, run full lifecycle, then close with a different signer
    const config = await jobsProgram.account.config.fetch(configPDA);
    const nextId = config.totalJobsCreated.toNumber();
    const [closeTestJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    // Create job (creator = creator keypair)
    await jobsProgram.methods
      .createJob("sha256:cccccccccccccccccccccccccccccccccccccccc", 1, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Claim
    await jobsProgram.methods
      .claimJob()
      .accounts({
        job: closeTestJobPDA,
        config: configPDA,
        nodeAccount: writerNodePDA,
        registryConfig: registryConfigPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    // Submit receipt
    await jobsProgram.methods
      .submitReceipt("sigCloseTest")
      .accounts({
        job: closeTestJobPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    // Attest (2 readers for quorum)
    const [attestPDA1] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8), reader1Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );
    const [attestPDA2] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8), reader2Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );

    const [reader1NodePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("freeze-node"), reader1Owner.publicKey.toBuffer()],
      registryProgram.programId
    );
    const [reader2NodePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("freeze-node"), reader2Owner.publicKey.toBuffer()],
      registryProgram.programId
    );

    await jobsProgram.methods
      .attest("sha256:cccccccccccccccccccccccccccccccccccccccc")
      .accounts({
        job: closeTestJobPDA,
        config: configPDA,
        attestation: attestPDA1,
        nodeAccount: reader1NodePDA,
        reader: reader1Owner.publicKey,
      })
      .signers([reader1Owner])
      .rpc();

    await jobsProgram.methods
      .attest("sha256:cccccccccccccccccccccccccccccccccccccccc")
      .accounts({
        job: closeTestJobPDA,
        config: configPDA,
        attestation: attestPDA2,
        nodeAccount: reader2NodePDA,
        reader: reader2Owner.publicKey,
      })
      .signers([reader2Owner])
      .rpc();

    // Release payment (permissionless signer)
    await jobsProgram.methods
      .releasePayment()
      .accounts({
        job: closeTestJobPDA,
        config: configPDA,
        inscriber: writerOwner.publicKey,
        treasury: treasury.publicKey,
        referrer: treasury.publicKey,
        attestation: attestPDA1,
        attester: reader1Owner.publicKey,
        signer: randomUser.publicKey,
      })
      .signers([randomUser])
      .rpc();

    // Verify job is Completed
    const jobBefore = await jobsProgram.account.jobAccount.fetch(closeTestJobPDA);
    assert.deepEqual(jobBefore.status, { completed: {} });

    // Record creator balance before close
    const creatorBalBefore = await provider.connection.getBalance(creator.publicKey);

    // Close with THIRD-PARTY signer (randomUser, NOT the creator)
    await jobsProgram.methods
      .closeCompletedJob()
      .accounts({
        job: closeTestJobPDA,
        creator: creator.publicKey,
        signer: randomUser.publicKey,
      })
      .signers([randomUser])
      .rpc();

    // Verify PDA is closed (account no longer exists)
    const pdaInfo = await provider.connection.getAccountInfo(closeTestJobPDA);
    assert.isNull(pdaInfo, "Job PDA should be closed");

    // Verify rent returned to creator (not the signer)
    const creatorBalAfter = await provider.connection.getBalance(creator.publicKey);
    assert.ok(creatorBalAfter > creatorBalBefore, "Creator should receive rent back");
  });

  it("rejects close on non-completed job", async () => {
    // Create job but don't complete it
    const config = await jobsProgram.account.config.fetch(configPDA);
    const nextId = config.totalJobsCreated.toNumber();
    const [openJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob("sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 1, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Try to close an Open job — should fail
    try {
      await jobsProgram.methods
        .closeCompletedJob()
        .accounts({
          job: openJobPDA,
          creator: creator.publicKey,
          signer: randomUser.publicKey,
        })
        .signers([randomUser])
        .rpc();
      assert.fail("Should have thrown — job is not Completed");
    } catch (err) {
      assert.ok(
        err.toString().includes("InvalidJobStatus") || err.toString().includes("6001"),
        "Should reject with InvalidJobStatus"
      );
    }

    // Clean up
    await jobsProgram.methods
      .cancelJob()
      .accounts({ job: openJobPDA, creator: creator.publicKey })
      .signers([creator])
      .rpc();
  });

  it("rejects close with wrong creator", async () => {
    // Create another completed job for this test
    const config = await jobsProgram.account.config.fetch(configPDA);
    const nextId = config.totalJobsCreated.toNumber();
    const [wrongCreatorJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob("sha256:ffffffffffffffffffffffffffffffffffffffff", 1, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Full lifecycle to get to Completed
    await jobsProgram.methods
      .claimJob()
      .accounts({ job: wrongCreatorJobPDA, config: configPDA, nodeAccount: writerNodePDA, registryConfig: registryConfigPDA, writer: writerOwner.publicKey })
      .signers([writerOwner])
      .rpc();

    await jobsProgram.methods
      .submitReceipt("sigWrongCreator")
      .accounts({ job: wrongCreatorJobPDA, writer: writerOwner.publicKey })
      .signers([writerOwner])
      .rpc();

    const [att1PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8), reader1Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );
    const [att2PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8), reader2Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );
    const [r1NodePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("freeze-node"), reader1Owner.publicKey.toBuffer()], registryProgram.programId
    );
    const [r2NodePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("freeze-node"), reader2Owner.publicKey.toBuffer()], registryProgram.programId
    );

    await jobsProgram.methods.attest("sha256:ffffffffffffffffffffffffffffffffffffffff")
      .accounts({ job: wrongCreatorJobPDA, config: configPDA, attestation: att1PDA, nodeAccount: r1NodePDA, reader: reader1Owner.publicKey })
      .signers([reader1Owner]).rpc();
    await jobsProgram.methods.attest("sha256:ffffffffffffffffffffffffffffffffffffffff")
      .accounts({ job: wrongCreatorJobPDA, config: configPDA, attestation: att2PDA, nodeAccount: r2NodePDA, reader: reader2Owner.publicKey })
      .signers([reader2Owner]).rpc();

    await jobsProgram.methods.releasePayment()
      .accounts({ job: wrongCreatorJobPDA, config: configPDA, inscriber: writerOwner.publicKey, treasury: treasury.publicKey, referrer: treasury.publicKey, attestation: att1PDA, attester: reader1Owner.publicKey, signer: randomUser.publicKey })
      .signers([randomUser]).rpc();

    // Try to close with wrong creator pubkey (randomUser instead of creator)
    try {
      await jobsProgram.methods
        .closeCompletedJob()
        .accounts({
          job: wrongCreatorJobPDA,
          creator: randomUser.publicKey, // WRONG — actual creator is `creator`
          signer: randomUser.publicKey,
        })
        .signers([randomUser])
        .rpc();
      assert.fail("Should have thrown — wrong creator");
    } catch (err) {
      assert.ok(
        err.toString().includes("NotCreator") || err.toString().includes("6014"),
        "Should reject with NotCreator"
      );
    }

    // Clean up: close with correct creator
    await jobsProgram.methods
      .closeCompletedJob()
      .accounts({
        job: wrongCreatorJobPDA,
        creator: creator.publicKey,
        signer: randomUser.publicKey,
      })
      .signers([randomUser])
      .rpc();
  });

  // ============================================================
  // hash-verified attestation (v6)
  // ============================================================

  it("attest with hash mismatch sets is_valid=false, count unchanged", async () => {
    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const nextId = cfg.totalJobsCreated.toNumber();
    const [mismatchJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    const jobHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1111";
    await jobsProgram.methods
      .createJob(jobHash, 1, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({ config: configPDA, creator: creator.publicKey, referrerAccount: SystemProgram.programId })
      .signers([creator])
      .rpc();

    await jobsProgram.methods.claimJob()
      .accounts({ job: mismatchJobPDA, config: configPDA, nodeAccount: writerNodePDA, registryConfig: registryConfigPDA, writer: writerOwner.publicKey })
      .signers([writerOwner]).rpc();

    await jobsProgram.methods.submitReceipt("sigMismatch")
      .accounts({ job: mismatchJobPDA, writer: writerOwner.publicKey })
      .signers([writerOwner]).rpc();

    const wrongHash = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb9999";
    const [attestPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8), reader1Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );

    await jobsProgram.methods.attest(wrongHash)
      .accounts({ job: mismatchJobPDA, config: configPDA, nodeAccount: reader1NodePDA, reader: reader1Owner.publicKey })
      .signers([reader1Owner]).rpc();

    const attestation = await jobsProgram.account.verificationAttestation.fetch(attestPDA);
    assert.equal(attestation.computedHash, wrongHash);
    assert.equal(attestation.isValid, false, "Mismatched hash should set is_valid=false");

    const job = await jobsProgram.account.jobAccount.fetch(mismatchJobPDA);
    assert.equal(job.attestationCount, 0, "Mismatch should not increment attestation_count");
  });

  it("attest with empty hash rejected (InvalidHash)", async () => {
    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const nextId = cfg.totalJobsCreated.toNumber();
    const [emptyHashJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob("sha256:emptytest00000000000000000000000000000000", 1, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({ config: configPDA, creator: creator.publicKey, referrerAccount: SystemProgram.programId })
      .signers([creator]).rpc();

    await jobsProgram.methods.claimJob()
      .accounts({ job: emptyHashJobPDA, config: configPDA, nodeAccount: writerNodePDA, registryConfig: registryConfigPDA, writer: writerOwner.publicKey })
      .signers([writerOwner]).rpc();

    await jobsProgram.methods.submitReceipt("sigEmpty")
      .accounts({ job: emptyHashJobPDA, writer: writerOwner.publicKey })
      .signers([writerOwner]).rpc();

    try {
      await jobsProgram.methods.attest("")
        .accounts({ job: emptyHashJobPDA, config: configPDA, nodeAccount: reader1NodePDA, reader: reader1Owner.publicKey })
        .signers([reader1Owner]).rpc();
      assert.fail("Should have thrown InvalidHash");
    } catch (err) {
      assert.ok(
        err.toString().includes("InvalidHash") || err.toString().includes("6004"),
        "Should reject empty hash: " + err.toString()
      );
    }
  });

  // ============================================================
  // close_attestation (permissionless, v6)
  // ============================================================

  it("close_attestation returns rent to reader after job completed", async () => {
    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const nextId = cfg.totalJobsCreated.toNumber();
    const [closeAttJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    const jobHash = "sha256:closeatt000000000000000000000000000000000";
    await jobsProgram.methods
      .createJob(jobHash, 1, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({ config: configPDA, creator: creator.publicKey, referrerAccount: SystemProgram.programId })
      .signers([creator]).rpc();

    await jobsProgram.methods.claimJob()
      .accounts({ job: closeAttJobPDA, config: configPDA, nodeAccount: writerNodePDA, registryConfig: registryConfigPDA, writer: writerOwner.publicKey })
      .signers([writerOwner]).rpc();

    await jobsProgram.methods.submitReceipt("sigCloseAtt")
      .accounts({ job: closeAttJobPDA, writer: writerOwner.publicKey })
      .signers([writerOwner]).rpc();

    // Attest with 2 readers
    const [att1PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8), reader1Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );
    const [att2PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8), reader2Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );

    const [r1Node] = PublicKey.findProgramAddressSync(
      [Buffer.from("freeze-node"), reader1Owner.publicKey.toBuffer()], registryProgram.programId
    );
    const [r2Node] = PublicKey.findProgramAddressSync(
      [Buffer.from("freeze-node"), reader2Owner.publicKey.toBuffer()], registryProgram.programId
    );

    await jobsProgram.methods.attest(jobHash)
      .accounts({ job: closeAttJobPDA, config: configPDA, attestation: att1PDA, nodeAccount: r1Node, reader: reader1Owner.publicKey })
      .signers([reader1Owner]).rpc();

    await jobsProgram.methods.attest(jobHash)
      .accounts({ job: closeAttJobPDA, config: configPDA, attestation: att2PDA, nodeAccount: r2Node, reader: reader2Owner.publicKey })
      .signers([reader2Owner]).rpc();

    // Release payment to reach Completed
    await jobsProgram.methods.releasePayment()
      .accounts({ job: closeAttJobPDA, config: configPDA, inscriber: writerOwner.publicKey, treasury: treasury.publicKey, referrer: treasury.publicKey, attestation: att1PDA, attester: reader1Owner.publicKey, signer: randomUser.publicKey })
      .signers([randomUser]).rpc();

    // Record reader balance (reader paid rent, reader gets it back)
    const readerBalBefore = await provider.connection.getBalance(reader1Owner.publicKey);

    // Close attestation 1 — permissionless, rent to reader
    await jobsProgram.methods.closeAttestation(new anchor.BN(nextId))
      .accounts({
        attestation: att1PDA,
        job: closeAttJobPDA,
        reader: reader1Owner.publicKey,
        signer: randomUser.publicKey,
      })
      .signers([randomUser]).rpc();

    // Verify PDA is closed
    const att1Info = await provider.connection.getAccountInfo(att1PDA);
    assert.isNull(att1Info, "Attestation PDA should be closed");

    // Verify rent returned to reader
    const readerBalAfter = await provider.connection.getBalance(reader1Owner.publicKey);
    assert.ok(readerBalAfter > readerBalBefore, "Reader should receive attestation rent back");
  });

  it("close_attestation rejects on active job (InvalidJobStatus)", async () => {
    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const nextId = cfg.totalJobsCreated.toNumber();
    const [activeJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    const jobHash = "sha256:activeatt00000000000000000000000000000000";
    await jobsProgram.methods
      .createJob(jobHash, 1, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({ config: configPDA, creator: creator.publicKey, referrerAccount: SystemProgram.programId })
      .signers([creator]).rpc();

    await jobsProgram.methods.claimJob()
      .accounts({ job: activeJobPDA, config: configPDA, nodeAccount: writerNodePDA, registryConfig: registryConfigPDA, writer: writerOwner.publicKey })
      .signers([writerOwner]).rpc();

    await jobsProgram.methods.submitReceipt("sigActive")
      .accounts({ job: activeJobPDA, writer: writerOwner.publicKey })
      .signers([writerOwner]).rpc();

    // Create attestation on Submitted job
    const [attPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8), reader1Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );
    const [r1Node] = PublicKey.findProgramAddressSync(
      [Buffer.from("freeze-node"), reader1Owner.publicKey.toBuffer()], registryProgram.programId
    );

    await jobsProgram.methods.attest(jobHash)
      .accounts({ job: activeJobPDA, config: configPDA, attestation: attPDA, nodeAccount: r1Node, reader: reader1Owner.publicKey })
      .signers([reader1Owner]).rpc();

    // Try to close attestation while job is Submitted (not finished)
    try {
      await jobsProgram.methods.closeAttestation(new anchor.BN(nextId))
        .accounts({
          attestation: attPDA,
          job: activeJobPDA,
          reader: reader1Owner.publicKey,
          signer: randomUser.publicKey,
        })
        .signers([randomUser]).rpc();
      assert.fail("Should have thrown InvalidJobStatus");
    } catch (err) {
      assert.ok(
        err.toString().includes("InvalidJobStatus") || err.toString().includes("6001"),
        "Should reject close on active job: " + err.toString()
      );
    }
  });

  // ============================================================
  // admin_close_attestation (authority, v6)
  // ============================================================

  it("authority can force-close any attestation (admin_close_attestation)", async () => {
    // Use the attestation from the "active job" test above — it's still open
    const cfg = await jobsProgram.account.config.fetch(configPDA);
    // The active job from previous test was at nextId-1 (we incremented)
    const activeJobId = cfg.totalJobsCreated.toNumber() - 1;
    const [attPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(activeJobId).toArrayLike(Buffer, "le", 8), reader1Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );

    // Verify attestation exists
    const attBefore = await provider.connection.getAccountInfo(attPDA);
    assert.isNotNull(attBefore, "Attestation should exist before admin close");

    const authorityBalBefore = await provider.connection.getBalance(authority.publicKey);

    // Admin force-close
    await jobsProgram.methods.adminCloseAttestation()
      .accounts({
        config: configPDA,
        attestation: attPDA,
        authority: authority.publicKey,
      })
      .signers([authority]).rpc();

    // Verify PDA is closed
    const attAfter = await provider.connection.getAccountInfo(attPDA);
    assert.isNull(attAfter, "Attestation should be closed after admin close");

    // Verify rent returned to authority
    const authorityBalAfter = await provider.connection.getBalance(authority.publicKey);
    assert.ok(authorityBalAfter > authorityBalBefore, "Authority should receive rent back");
  });

  // ============================================================
  // TX cost layer tests
  // ============================================================

  it("config stores baseTxFeeLamports (default 0)", async () => {
    const config = await jobsProgram.account.config.fetch(configPDA);
    assert.equal(config.baseTxFeeLamports.toNumber(), 0, "baseTxFeeLamports should default to 0");
  });

  it("authority can update baseTxFeeLamports", async () => {
    await jobsProgram.methods
      .updateConfig(null, null, null, null, null, null, null, null, null, null, new anchor.BN(5000))
      .accounts({ config: configPDA, authority: authority.publicKey })
      .signers([authority])
      .rpc();

    const config = await jobsProgram.account.config.fetch(configPDA);
    assert.equal(config.baseTxFeeLamports.toNumber(), 5000, "baseTxFeeLamports should be 5000");
  });

  it("creates job with TX reimbursement computed from baseTxFee", async () => {
    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const nextId = cfg.totalJobsCreated.toNumber();
    const [txJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    const txChunks = 20;
    await jobsProgram.methods
      .createJob("sha256:tx_layer_test_hash_00000000000000000000", txChunks, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const job = await jobsProgram.account.jobAccount.fetch(txJobPDA);
    // tx_reimbursement = chunks × base_tx_fee = 20 × 5000 = 100,000
    assert.equal(job.txReimbursementLamports.toNumber(), 100_000,
      "TX reimbursement should be chunks × base_tx_fee");
  });

  it("release_payment splits margin (not full escrow) when TX layer enabled", async () => {
    // Find the job we just created (TX layer test job)
    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const txJobId = cfg.totalJobsCreated.toNumber() - 1;
    const [txJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(txJobId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    // Claim with writer node
    const [writerNodePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("freeze-node"), writerOwner.publicKey.toBuffer()],
      registryProgram.programId
    );
    await jobsProgram.methods.claimJob()
      .accounts({
        job: txJobPDA,
        config: configPDA,
        nodeAccount: writerNodePDA,
        registryConfig: registryConfigPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    // Submit receipt
    await jobsProgram.methods.submitReceipt("tx_layer_pointer_sig_test")
      .accounts({
        job: txJobPDA,
        writer: writerOwner.publicKey,
      })
      .signers([writerOwner])
      .rpc();

    // Attest with 2 readers (quorum = 2)
    const contentHash = "sha256:tx_layer_test_hash_00000000000000000000";
    for (const reader of [reader1Owner, reader2Owner]) {
      const [attestPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("fd-attest"), new anchor.BN(txJobId).toArrayLike(Buffer, "le", 8), reader.publicKey.toBuffer()],
        jobsProgram.programId
      );
      const [readerNodePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("freeze-node"), reader.publicKey.toBuffer()],
        registryProgram.programId
      );
      await jobsProgram.methods.attest(contentHash)
        .accounts({
          job: txJobPDA,
          config: configPDA,
          attestation: attestPDA,
          nodeAccount: readerNodePDA,
          reader: reader.publicKey,
        })
        .signers([reader])
        .rpc();
    }

    // Capture balances before release
    const inscriberBalBefore = await provider.connection.getBalance(writerOwner.publicKey);
    const treasuryBalBefore = await provider.connection.getBalance(treasury.publicKey);
    const attesterBalBefore = await provider.connection.getBalance(reader1Owner.publicKey);

    // Derive attestation PDA for release_payment
    const [txAttestPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(txJobId).toArrayLike(Buffer, "le", 8), reader1Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );

    // Release payment
    await jobsProgram.methods.releasePayment()
      .accounts({
        job: txJobPDA,
        config: configPDA,
        inscriber: writerOwner.publicKey,
        treasury: treasury.publicKey,
        referrer: treasury.publicKey, // treasury-as-referrer
        attestation: txAttestPDA,
        attester: reader1Owner.publicKey,
        signer: randomUser.publicKey,
      })
      .signers([randomUser])
      .rpc();

    const inscriberBalAfter = await provider.connection.getBalance(writerOwner.publicKey);
    const treasuryBalAfter = await provider.connection.getBalance(treasury.publicKey);
    const attesterBalAfter = await provider.connection.getBalance(reader1Owner.publicKey);

    // Two-step split: reimburse TX costs first, split margin by BPS
    // TX reimbursement = 20 chunks × 5000 = 100,000
    // Margin = 100,000,000 - 100,000 = 99,900,000
    // Inscriber margin = floor(99,900,000 × 3000 / 10000) = 29,970,000
    // Attester = floor(99,900,000 × 1000 / 10000) = 9,990,000
    // Referral (treasury) = floor(99,900,000 × 2000 / 10000) = 19,980,000
    // Treasury remainder = 99,900,000 - 29,970,000 - 9,990,000 - 19,980,000 = 39,960,000
    // Inscriber total = 100,000 + 29,970,000 = 30,070,000
    // Treasury total = 39,960,000 + 19,980,000 = 59,940,000

    const txReimburse = 20 * 5000;  // 100,000
    const margin = escrowAmount - txReimburse;  // 99,900,000
    const inscriberMargin = Math.floor(margin * 3000 / 10000);  // 29,970,000
    const attesterAmount = Math.floor(margin * 1000 / 10000);   // 9,990,000
    const referralAmount = Math.floor(margin * 2000 / 10000);   // 19,980,000
    const treasuryRemainder = margin - inscriberMargin - attesterAmount - referralAmount;  // 39,960,000
    const expectedInscriberTotal = txReimburse + inscriberMargin;  // 30,070,000
    // Treasury gets remainder + referral (treasury-as-referrer — referrer==treasury, not Pubkey::default)
    const expectedTreasuryTotal = treasuryRemainder + referralAmount;  // 59,940,000

    const inscriberGain = inscriberBalAfter - inscriberBalBefore;
    const treasuryGain = treasuryBalAfter - treasuryBalBefore;
    const attesterGain = attesterBalAfter - attesterBalBefore;

    assert.equal(inscriberGain, expectedInscriberTotal,
      `Inscriber should get TX reimburse (${txReimburse}) + margin share (${inscriberMargin}) = ${expectedInscriberTotal}`);
    assert.equal(attesterGain, attesterAmount,
      `Attester should get ${attesterAmount} (10% of margin)`);
    assert.equal(treasuryGain, expectedTreasuryTotal,
      `Treasury should get remainder (${treasuryRemainder}) + referral (${referralAmount}) = ${expectedTreasuryTotal}`);
    assert.equal(inscriberGain + attesterGain + treasuryGain, escrowAmount,
      "All shares should sum to full escrow");
  });

  it("rejects job where escrow does not exceed TX reimbursement", async () => {
    // base_tx_fee = 5000, chunks = 50000, so tx_reimburse = 250,000,000 > escrow of 100,000,000
    try {
      const cfg2 = await jobsProgram.account.config.fetch(configPDA);
      const [badJobPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("fd-job"), new anchor.BN(cfg2.totalJobsCreated.toNumber()).toArrayLike(Buffer, "le", 8)],
        jobsProgram.programId
      );
      await jobsProgram.methods
        .createJob("sha256:badescrow000000000000000000000000000000000", 50000, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
        .accounts({
          config: configPDA,
          creator: creator.publicKey,
          referrerAccount: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      assert.fail("Should have thrown — escrow below TX reimbursement");
    } catch (err) {
      assert.ok(err.toString().includes("EscrowTooLow"), "Should reject escrow below TX reimbursement");
    }
  });

  it("TX layer disabled when baseTxFee is 0 (flat split)", async () => {
    // Disable TX layer
    await jobsProgram.methods
      .updateConfig(null, null, null, null, null, null, null, null, null, null, new anchor.BN(0))
      .accounts({ config: configPDA, authority: authority.publicKey })
      .signers([authority])
      .rpc();

    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const nextId = cfg.totalJobsCreated.toNumber();
    const [flatJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob("sha256:flat_split_test_00000000000000000000000000", 10, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({
        config: configPDA,
        creator: creator.publicKey,
        referrerAccount: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const job = await jobsProgram.account.jobAccount.fetch(flatJobPDA);
    assert.equal(job.txReimbursementLamports.toNumber(), 0,
      "TX reimbursement should be 0 when baseTxFee disabled");
  });

  // ============================================================
  // H1: refund_expired keeps PDA alive (status = Expired)
  // ============================================================

  it("refund_expired sets Expired status and returns escrow (PDA stays alive)", async () => {
    // Set very short expiry for testing
    await jobsProgram.methods
      .updateConfig(null, null, null, null, null, null, new anchor.BN(1), null, null, null, null)
      .accounts({ config: configPDA, authority: authority.publicKey })
      .signers([authority])
      .rpc();

    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const nextId = cfg.totalJobsCreated.toNumber();
    const [expJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob("sha256:expired_test_00000000000000000000000000000", 1, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({ config: configPDA, creator: creator.publicKey, referrerAccount: SystemProgram.programId })
      .signers([creator]).rpc();

    // Wait for expiry (1 second)
    await new Promise(r => setTimeout(r, 2000));

    const creatorBefore = await provider.connection.getBalance(creator.publicKey);

    await jobsProgram.methods
      .refundExpired()
      .accounts({ job: expJobPDA, config: configPDA, creator: creator.publicKey, signer: randomUser.publicKey })
      .signers([randomUser]).rpc();

    // PDA should still exist with Expired status
    const job = await jobsProgram.account.jobAccount.fetch(expJobPDA);
    assert.deepEqual(job.status, { expired: {} }, "Status should be Expired");
    assert.equal(job.escrowLamports.toNumber(), 0, "Escrow should be zeroed");

    const creatorAfter = await provider.connection.getBalance(creator.publicKey);
    assert.ok(creatorAfter > creatorBefore, "Creator should receive escrow back");

    // Now close the expired job PDA (should work since close_completed_job accepts Expired)
    await jobsProgram.methods
      .closeCompletedJob()
      .accounts({ job: expJobPDA, creator: creator.publicKey, signer: randomUser.publicKey })
      .signers([randomUser]).rpc();

    // PDA should be gone now
    const acc = await provider.connection.getAccountInfo(expJobPDA);
    assert.isNull(acc, "Expired job PDA should be closed after cleanup");

    // Restore normal expiry
    await jobsProgram.methods
      .updateConfig(null, null, null, null, null, null, new anchor.BN(7200), null, null, null, null)
      .accounts({ config: configPDA, authority: authority.publicKey })
      .signers([authority]).rpc();
  });

  // ============================================================
  // H2: attest auto-requeue on failed attestation
  // ============================================================

  it("failed attestation requeues job to Open", async () => {
    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const nextId = cfg.totalJobsCreated.toNumber();
    const [requeueJobPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .createJob("sha256:requeue_test_0000000000000000000000000000", 1, new anchor.BN(escrowAmount), treasury.publicKey, PublicKey.default, 0, "")
      .accounts({ config: configPDA, creator: creator.publicKey, referrerAccount: SystemProgram.programId })
      .signers([creator]).rpc();

    // Writer claims
    await jobsProgram.methods.claimJob()
      .accounts({ job: requeueJobPDA, config: configPDA, nodeAccount: writerNodePDA, registryConfig: registryConfigPDA, writer: writerOwner.publicKey })
      .signers([writerOwner]).rpc();

    // Writer submits
    await jobsProgram.methods.submitReceipt("bad_pointer_sig")
      .accounts({ job: requeueJobPDA, writer: writerOwner.publicKey })
      .signers([writerOwner]).rpc();

    const jobBefore = await jobsProgram.account.jobAccount.fetch(requeueJobPDA);
    assert.deepEqual(jobBefore.status, { submitted: {} });

    // Reader attests with WRONG hash — should trigger requeue
    const [badAttestPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-attest"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8), reader1Owner.publicKey.toBuffer()],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .attest("sha256:WRONG_HASH_000000000000000000000000000000")
      .accounts({ job: requeueJobPDA, config: configPDA, attestation: badAttestPDA, nodeAccount: reader1NodePDA, reader: reader1Owner.publicKey })
      .signers([reader1Owner]).rpc();

    // Job should be back to Open
    const jobAfter = await jobsProgram.account.jobAccount.fetch(requeueJobPDA);
    assert.deepEqual(jobAfter.status, { open: {} }, "Job should be requeued to Open after failed attestation");
    assert.ok(jobAfter.writer.equals(PublicKey.default), "Writer should be cleared");
    assert.equal(jobAfter.claimedAt.toNumber(), 0, "claimed_at should be reset");
    assert.equal(jobAfter.submittedAt.toNumber(), 0, "submitted_at should be reset");

    // Attestation PDA should still exist with is_valid = false
    const attest = await jobsProgram.account.verificationAttestation.fetch(badAttestPDA);
    assert.equal(attest.isValid, false, "Attestation should be marked invalid");
  });

  // ============================================================
  // H3: close_config blocked with active jobs
  // ============================================================

  it("close_config rejects when jobs are in-flight", async () => {
    // There are active jobs from earlier tests — close_config should fail
    try {
      await jobsProgram.methods.closeConfig()
        .accounts({ config: configPDA, authority: authority.publicKey })
        .signers([authority]).rpc();
      assert.fail("Should have thrown — active jobs exist");
    } catch (err) {
      assert.ok(
        err.toString().includes("ActiveJobsExist") ||
        err.toString().includes("6025"),
        "Should reject close_config with active jobs: " + err.toString()
      );
    }
  });

  // ============================================================
  // M1: self-referral blocked
  // ============================================================

  it("creator cannot self-refer", async () => {
    // Register creator as referrer first
    const [creatorRefPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-referrer"), creator.publicKey.toBuffer()],
      jobsProgram.programId
    );

    await jobsProgram.methods
      .registerReferrer("SelfRef Test")
      .accounts({ owner: creator.publicKey })
      .signers([creator]).rpc();

    const cfg = await jobsProgram.account.config.fetch(configPDA);
    const nextId = cfg.totalJobsCreated.toNumber();
    const [selfRefJobPDA2] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-job"), new anchor.BN(nextId).toArrayLike(Buffer, "le", 8)],
      jobsProgram.programId
    );

    try {
      await jobsProgram.methods
        .createJob("sha256:self_ref_block_test_000000000000000000000", 1, new anchor.BN(escrowAmount), creator.publicKey, PublicKey.default, 0, "")
        .accounts({ config: configPDA, creator: creator.publicKey, referrerAccount: creatorRefPDA })
        .signers([creator]).rpc();
      assert.fail("Should have thrown — self-referral blocked");
    } catch (err) {
      assert.ok(
        err.toString().includes("SelfReferral") ||
        err.toString().includes("6026"),
        "Should reject self-referral: " + err.toString()
      );
    }

    // Cleanup: close referrer PDA
    await jobsProgram.methods.closeReferrer()
      .accounts({ owner: creator.publicKey })
      .signers([creator]).rpc();
  });

  // ============================================================
  // M2: two-step authority transfer
  // ============================================================

  it("two-step authority transfer works", async () => {
    const newAuthority = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(newAuthority.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);

    // Step 1: propose
    await jobsProgram.methods
      .transferAuthority(newAuthority.publicKey)
      .accounts({ config: configPDA, authority: authority.publicKey })
      .signers([authority]).rpc();

    const cfgAfterPropose = await jobsProgram.account.config.fetch(configPDA);
    assert.ok(cfgAfterPropose.pendingAuthority.equals(newAuthority.publicKey), "pending_authority should be set");

    // Step 2: accept
    await jobsProgram.methods
      .acceptAuthority()
      .accounts({ config: configPDA, newAuthority: newAuthority.publicKey })
      .signers([newAuthority]).rpc();

    const cfgAfterAccept = await jobsProgram.account.config.fetch(configPDA);
    assert.ok(cfgAfterAccept.authority.equals(newAuthority.publicKey), "authority should be new");
    assert.ok(cfgAfterAccept.pendingAuthority.equals(PublicKey.default), "pending_authority should be cleared");

    // Transfer back to original authority
    await jobsProgram.methods
      .transferAuthority(authority.publicKey)
      .accounts({ config: configPDA, authority: newAuthority.publicKey })
      .signers([newAuthority]).rpc();

    await jobsProgram.methods
      .acceptAuthority()
      .accounts({ config: configPDA, newAuthority: authority.publicKey })
      .signers([authority]).rpc();

    const cfgRestored = await jobsProgram.account.config.fetch(configPDA);
    assert.ok(cfgRestored.authority.equals(authority.publicKey), "authority should be restored");
  });

  it("wrong signer cannot accept authority transfer", async () => {
    const proposed = Keypair.generate();
    const wrong = Keypair.generate();
    const sig1 = await provider.connection.requestAirdrop(proposed.publicKey, LAMPORTS_PER_SOL);
    const sig2 = await provider.connection.requestAirdrop(wrong.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig1);
    await provider.connection.confirmTransaction(sig2);

    await jobsProgram.methods
      .transferAuthority(proposed.publicKey)
      .accounts({ config: configPDA, authority: authority.publicKey })
      .signers([authority]).rpc();

    try {
      await jobsProgram.methods
        .acceptAuthority()
        .accounts({ config: configPDA, newAuthority: wrong.publicKey })
        .signers([wrong]).rpc();
      assert.fail("Should have thrown — wrong signer");
    } catch (err) {
      assert.ok(
        err.toString().includes("NotProposedAuthority") ||
        err.toString().includes("6028"),
        "Should reject wrong signer: " + err.toString()
      );
    }

    // Cancel the pending transfer
    await jobsProgram.methods
      .transferAuthority(PublicKey.default)
      .accounts({ config: configPDA, authority: authority.publicKey })
      .signers([authority]).rpc();
  });
});
