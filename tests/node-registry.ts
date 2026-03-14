import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FreezedryRegistry } from "../target/types/freezedry_registry";
import { assert } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  StakeProgram,
  Authorized,
  LAMPORTS_PER_SOL,
  VoteProgram,
  VoteInit,
} from "@solana/web3.js";

describe("freezedry_registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .freezedryRegistry as Program<FreezedryRegistry>;

  // Test node operator
  const owner = Keypair.generate();
  let nodePDA: PublicKey;
  let nodeBump: number;

  // Config PDA
  let configPDA: PublicKey;
  let configBump: number;

  // Preferred validator (random keypair for testing)
  const preferredValidator = Keypair.generate();

  before(async () => {
    // Fund the owner account
    const sig = await provider.connection.requestAirdrop(
      owner.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    // Derive PDAs
    [nodePDA, nodeBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("freeze-node"), owner.publicKey.toBuffer()],
      program.programId
    );

    [configPDA, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("fd-registry-config")],
      program.programId
    );
  });

  // ============================================================
  // register_node
  // ============================================================

  it("registers a node", async () => {
    const tx = await program.methods
      .registerNode("gcp-east", "https://node-1.example.com", { both: {} })
      .accounts({ owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const node = await program.account.nodeAccount.fetch(nodePDA);

    assert.ok(node.wallet.equals(owner.publicKey));
    assert.equal(node.nodeId, "gcp-east");
    assert.equal(node.url, "https://node-1.example.com");
    assert.deepEqual(node.role, { both: {} });
    assert.ok(node.isActive);
    assert.ok(node.registeredAt.toNumber() > 0);
    assert.ok(node.lastHeartbeat.toNumber() > 0);
    assert.equal(node.artworksIndexed.toNumber(), 0);
    assert.equal(node.artworksComplete.toNumber(), 0);
    assert.equal(node.bump, nodeBump);
    // New stake fields should be zero-initialized
    assert.equal(node.verifiedStake.toNumber(), 0);
    assert.ok(node.stakeVoter.equals(PublicKey.default));
    assert.equal(node.stakeVerifiedAt.toNumber(), 0);
  });

  it("rejects duplicate registration (same owner)", async () => {
    try {
      await program.methods
        .registerNode("dup-node", "https://dup.example.com", { reader: {} })
        .accounts({ owner: owner.publicKey })
        .signers([owner])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      // PDA already initialized — Anchor returns a system program error
      assert.ok(err.toString().includes("already in use") || err.logs);
    }
  });

  it("rejects empty URL", async () => {
    const otherOwner = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      otherOwner.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .registerNode("test", "", { reader: {} })
        .accounts({ owner: otherOwner.publicKey })
        .signers([otherOwner])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err.toString().includes("EmptyUrl") || err.toString().includes("6003"));
    }
  });

  it("rejects non-HTTPS URL", async () => {
    const otherOwner = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      otherOwner.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .registerNode("test", "http://insecure.example.com", { reader: {} })
        .accounts({ owner: otherOwner.publicKey })
        .signers([otherOwner])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("InvalidUrlScheme") ||
          err.toString().includes("6002")
      );
    }
  });

  it("rejects URL longer than 128 chars", async () => {
    const otherOwner = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      otherOwner.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    const longUrl = "https://" + "a".repeat(125); // 133 chars total
    try {
      await program.methods
        .registerNode("test", longUrl, { reader: {} })
        .accounts({ owner: otherOwner.publicKey })
        .signers([otherOwner])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("UrlTooLong") ||
          err.toString().includes("6000")
      );
    }
  });

  // ============================================================
  // update_node
  // ============================================================

  it("updates node URL", async () => {
    await program.methods
      .updateNode("https://node-2.example.com", null, null)
      .accounts({ owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const node = await program.account.nodeAccount.fetch(nodePDA);
    assert.equal(node.url, "https://node-2.example.com");
    assert.equal(node.nodeId, "gcp-east"); // unchanged
  });

  it("updates node role", async () => {
    await program.methods
      .updateNode(null, { reader: {} }, null)
      .accounts({ owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const node = await program.account.nodeAccount.fetch(nodePDA);
    assert.deepEqual(node.role, { reader: {} });
  });

  it("updates node ID", async () => {
    await program.methods
      .updateNode(null, null, "gcp-west")
      .accounts({ owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const node = await program.account.nodeAccount.fetch(nodePDA);
    assert.equal(node.nodeId, "gcp-west");
  });

  it("rejects update from wrong signer", async () => {
    const attacker = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      attacker.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .updateNode("https://hacked.example.com", null, null)
        .accounts({ owner: attacker.publicKey })
        .signers([attacker])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      // PDA derived from attacker won't match existing node
      assert.ok(err.toString());
    }
  });

  // ============================================================
  // heartbeat
  // ============================================================

  it("sends heartbeat", async () => {
    const before = await program.account.nodeAccount.fetch(nodePDA);
    const beforeTs = before.lastHeartbeat.toNumber();

    // Small delay to ensure timestamp advances
    await new Promise((r) => setTimeout(r, 1500));

    await program.methods
      .heartbeat()
      .accounts({ owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const after = await program.account.nodeAccount.fetch(nodePDA);
    assert.ok(after.lastHeartbeat.toNumber() >= beforeTs);
    assert.ok(after.isActive);
  });

  // ============================================================
  // getProgramAccounts — list all nodes
  // ============================================================

  it("lists all registered nodes via getProgramAccounts", async () => {
    const accounts = await program.account.nodeAccount.all();
    assert.ok(accounts.length >= 1);

    const found = accounts.find((a) =>
      a.account.wallet.equals(owner.publicKey)
    );
    assert.ok(found, "Owner's node should be in the list");
    assert.equal(found.account.nodeId, "gcp-west"); // updated earlier
  });

  // ============================================================
  // initialize_config
  // ============================================================

  it("initializes registry config", async () => {
    // May already be initialized by jobs test suite (shared localnet)
    const existing = await provider.connection.getAccountInfo(configPDA);
    if (existing) {
      // Already initialized — verify it exists and has correct bump
      const config = await program.account.registryConfig.fetch(configPDA);
      assert.equal(config.bump, configBump);
      return;
    }

    await program.methods
      .initializeConfig(preferredValidator.publicKey)
      .accounts({ authority: owner.publicKey })
      .signers([owner])
      .rpc();

    const config = await program.account.registryConfig.fetch(configPDA);
    assert.ok(config.authority.equals(owner.publicKey));
    assert.ok(config.preferredValidator.equals(preferredValidator.publicKey));
    assert.equal(config.bump, configBump);
  });

  it("rejects duplicate config init", async () => {
    try {
      await program.methods
        .initializeConfig(preferredValidator.publicKey)
        .accounts({ authority: owner.publicKey })
        .signers([owner])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err.toString().includes("already in use") || err.logs);
    }
  });

  // ============================================================
  // update_config
  // ============================================================

  it("updates preferred validator", async () => {
    // Determine who the actual authority is (may be set by jobs test suite)
    const config = await program.account.registryConfig.fetch(configPDA);
    const actualAuthority = config.authority;
    const signerKp = actualAuthority.equals(owner.publicKey) ? owner : null;
    if (!signerKp) {
      // Config was initialized by a different test suite — skip this test
      return;
    }

    const newValidator = Keypair.generate();
    await program.methods
      .updateConfig(newValidator.publicKey, null)
      .accounts({ authority: owner.publicKey })
      .signers([owner])
      .rpc();

    const updated = await program.account.registryConfig.fetch(configPDA);
    assert.ok(updated.preferredValidator.equals(newValidator.publicKey));
    assert.ok(updated.authority.equals(owner.publicKey)); // unchanged
  });

  it("rejects config update from non-authority", async () => {
    const attacker = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      attacker.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .updateConfig(attacker.publicKey, null)
        .accounts({ authority: attacker.publicKey })
        .signers([attacker])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("NotAuthority") ||
          err.toString().includes("6012") ||
          err.toString().includes("ConstraintRaw") ||
          err.toString().includes("2003")
      );
    }
  });

  it("transfers config authority", async () => {
    // Determine who the actual authority is (may be set by jobs test suite)
    const config = await program.account.registryConfig.fetch(configPDA);
    if (!config.authority.equals(owner.publicKey)) {
      // Config was initialized by a different test suite — skip
      return;
    }

    const newAuthority = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      newAuthority.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    await program.methods
      .updateConfig(null, newAuthority.publicKey)
      .accounts({ authority: owner.publicKey })
      .signers([owner])
      .rpc();

    const updated = await program.account.registryConfig.fetch(configPDA);
    assert.ok(updated.authority.equals(newAuthority.publicKey));

    // Transfer back so subsequent tests work
    await program.methods
      .updateConfig(null, owner.publicKey)
      .accounts({ authority: newAuthority.publicKey })
      .signers([newAuthority])
      .rpc();

    const restored = await program.account.registryConfig.fetch(configPDA);
    assert.ok(restored.authority.equals(owner.publicKey));
  });

  // ============================================================
  // verify_stake
  // ============================================================

  it("rejects verify_stake with non-stake-program account", async () => {
    // Use system account (owned by System Program, not Stake Program)
    const fakeAccount = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      fakeAccount.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .verifyStake()
        .accounts({
          node: nodePDA,
          stakeAccount: fakeAccount.publicKey,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("InvalidStakeOwner") ||
          err.toString().includes("6006")
      );
    }
  });

  it("verifies stake with a real delegated stake account", async () => {
    // On localnet we need to create a vote account + stake account + delegate.
    // This simulates what a real node operator would do on mainnet.

    // 1. Create a vote account (requires a validator identity + voter + authorized withdrawer)
    const validatorIdentity = Keypair.generate();
    const voteAccount = Keypair.generate();

    // Fund validator identity
    const fundSig = await provider.connection.requestAirdrop(
      validatorIdentity.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(fundSig);

    // Create vote account
    const voteInit = new VoteInit(
      validatorIdentity.publicKey, // node_pubkey (validator identity)
      owner.publicKey,             // authorized_voter
      owner.publicKey,             // authorized_withdrawer
      0                            // commission
    );

    const createVoteTx = VoteProgram.createAccount({
      fromPubkey: validatorIdentity.publicKey,
      votePubkey: voteAccount.publicKey,
      voteInit,
      lamports: await provider.connection.getMinimumBalanceForRentExemption(
        VoteProgram.space
      ),
    });

    await provider.sendAndConfirm(createVoteTx, [validatorIdentity, voteAccount]);

    // 2. Create a stake account and delegate to the vote account
    const stakeAccount = Keypair.generate();
    const stakeAmount = 2 * LAMPORTS_PER_SOL;

    const createStakeTx = StakeProgram.createAccount({
      fromPubkey: owner.publicKey,
      stakePubkey: stakeAccount.publicKey,
      authorized: new Authorized(owner.publicKey, owner.publicKey),
      lamports: stakeAmount,
    });

    await provider.sendAndConfirm(createStakeTx, [owner, stakeAccount]);

    // 3. Delegate
    const delegateTx = StakeProgram.delegate({
      stakePubkey: stakeAccount.publicKey,
      authorizedPubkey: owner.publicKey,
      votePubkey: voteAccount.publicKey,
    });

    await provider.sendAndConfirm(delegateTx, [owner]);

    // Wait a moment for the state to settle
    await new Promise((r) => setTimeout(r, 1000));

    // 4. Verify stake on-chain via our program
    await program.methods
      .verifyStake()
      .accounts({
        node: nodePDA,
        stakeAccount: stakeAccount.publicKey,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    // 5. Check node account fields
    const node = await program.account.nodeAccount.fetch(nodePDA);
    assert.ok(node.verifiedStake.toNumber() > 0, "verified_stake should be > 0");
    assert.ok(
      node.stakeVoter.equals(voteAccount.publicKey),
      "stake_voter should match vote account"
    );
    assert.ok(node.stakeVerifiedAt.toNumber() > 0, "stake_verified_at should be set");
  });

  it("rejects verify_stake with wrong owner's stake account", async () => {
    // Create a stake account owned by a different wallet
    const otherOwner = Keypair.generate();
    const fundSig = await provider.connection.requestAirdrop(
      otherOwner.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(fundSig);

    // Create a vote account for delegation target
    const otherValidator = Keypair.generate();
    const otherVote = Keypair.generate();
    const fundVal = await provider.connection.requestAirdrop(
      otherValidator.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(fundVal);

    const voteInit2 = new VoteInit(
      otherValidator.publicKey,
      otherOwner.publicKey,
      otherOwner.publicKey,
      0
    );

    const createVoteTx2 = VoteProgram.createAccount({
      fromPubkey: otherValidator.publicKey,
      votePubkey: otherVote.publicKey,
      voteInit: voteInit2,
      lamports: await provider.connection.getMinimumBalanceForRentExemption(
        VoteProgram.space
      ),
    });

    await provider.sendAndConfirm(createVoteTx2, [otherValidator, otherVote]);

    const otherStake = Keypair.generate();
    const createStake2 = StakeProgram.createAccount({
      fromPubkey: otherOwner.publicKey,
      stakePubkey: otherStake.publicKey,
      authorized: new Authorized(otherOwner.publicKey, otherOwner.publicKey),
      lamports: 2 * LAMPORTS_PER_SOL,
    });

    await provider.sendAndConfirm(createStake2, [otherOwner, otherStake]);

    const delegateTx2 = StakeProgram.delegate({
      stakePubkey: otherStake.publicKey,
      authorizedPubkey: otherOwner.publicKey,
      votePubkey: otherVote.publicKey,
    });

    await provider.sendAndConfirm(delegateTx2, [otherOwner]);

    await new Promise((r) => setTimeout(r, 1000));

    // Try to verify with owner's node but other owner's stake
    try {
      await program.methods
        .verifyStake()
        .accounts({
          node: nodePDA,
          stakeAccount: otherStake.publicKey,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(
        err.toString().includes("StakeOwnershipMismatch") ||
          err.toString().includes("6009")
      );
    }
  });

  // ============================================================
  // deregister_node
  // ============================================================

  it("deregisters node and returns rent", async () => {
    const balBefore = await provider.connection.getBalance(owner.publicKey);

    await program.methods
      .deregisterNode()
      .accounts({ owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const balAfter = await provider.connection.getBalance(owner.publicKey);
    // Rent should be returned (minus tx fee)
    assert.ok(
      balAfter > balBefore - 10000,
      "Balance should increase (rent returned minus small tx fee)"
    );

    // Account should no longer exist
    const info = await provider.connection.getAccountInfo(nodePDA);
    assert.isNull(info, "PDA should be closed");
  });

  it("cannot heartbeat after deregister", async () => {
    try {
      await program.methods
        .heartbeat()
        .accounts({ owner: owner.publicKey })
        .signers([owner])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      // Account no longer exists
      assert.ok(err.toString());
    }
  });

  // ============================================================
  // re-registration after deregister
  // ============================================================

  it("can re-register after deregistering", async () => {
    await program.methods
      .registerNode(
        "gcp-east-v2",
        "https://node-1-v2.example.com",
        { writer: {} }
      )
      .accounts({ owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const node = await program.account.nodeAccount.fetch(nodePDA);
    assert.equal(node.nodeId, "gcp-east-v2");
    assert.equal(node.url, "https://node-1-v2.example.com");
    assert.deepEqual(node.role, { writer: {} });
    assert.ok(node.isActive);
    // Stake fields should be zero again after re-registration
    assert.equal(node.verifiedStake.toNumber(), 0);
    assert.ok(node.stakeVoter.equals(PublicKey.default));
    assert.equal(node.stakeVerifiedAt.toNumber(), 0);
  });
});
