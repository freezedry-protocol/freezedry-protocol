import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FdPointer } from "../target/types/fd_pointer";
import { assert, expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import * as crypto from "crypto";

// ── Constants ────────────────────────────────────────────────────────────

const SEED_PREFIX = "fd-pointer";

// Content types matching state.rs
const CONTENT_TYPE_IMAGE = 0;
const CONTENT_TYPE_DOCUMENT = 1;
const CONTENT_TYPE_CERTIFICATE = 2;
const CONTENT_TYPE_VIDEO = 3;
const CONTENT_TYPE_AUDIO = 4;
const CONTENT_TYPE_OTHER = 5;

// Modes matching state.rs
const MODE_OPEN = 0;
const MODE_ENCRYPTED = 1;
const MODE_DIRECT = 3;

// ── Helpers ──────────────────────────────────────────────────────────────

/** Generate a deterministic SHA-256 hash from arbitrary data */
function sha256(data: string | Buffer): Buffer {
  return crypto.createHash("sha256").update(data).digest();
}

/** Generate an Ed25519 keypair for the artist signer (for delegated flow) */
function generateEd25519Keypair(): { publicKey: Buffer; secretKey: Buffer } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const priv = privateKey.export({ type: "pkcs8", format: "der" }).slice(-32);
  const pub_ = publicKey.export({ type: "spki", format: "der" }).slice(-32);
  return {
    publicKey: Buffer.from(pub_),
    secretKey: Buffer.concat([priv, pub_]),
  };
}

/** Build the pointer authorization message: "FreezeDry:pointer:{hash_hex}" */
function buildPointerMessage(contentHash: Buffer): Buffer {
  const hex = contentHash.toString("hex");
  return Buffer.from(`FreezeDry:pointer:${hex}`);
}

/** Sign a message with Ed25519 secret key */
function signMessage(message: Buffer, secretKey: Buffer): Buffer {
  const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
  return Buffer.from(
    crypto.sign(null, message, {
      key: Buffer.concat([PKCS8_PREFIX, secretKey.slice(0, 32)]),
      format: "der",
      type: "pkcs8",
    })
  );
}

/** Derive pointer PDA from content hash */
function findPointerPDA(contentHash: Buffer, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_PREFIX), contentHash],
    programId
  );
}

/** Generate a fake 64-byte "last signature" for testing */
function fakeSig(): number[] {
  return Array.from(crypto.randomBytes(64));
}

/** Airdrop SOL to a keypair */
async function airdrop(
  connection: anchor.web3.Connection,
  to: PublicKey,
  amount: number = 10 * LAMPORTS_PER_SOL
) {
  const sig = await connection.requestAirdrop(to, amount);
  await connection.confirmTransaction(sig, "confirmed");
}

/** Helper: create pointer via direct signing */
async function createPointerDirect(
  program: Program<FdPointer>,
  provider: anchor.AnchorProvider,
  inscriber: Keypair,
  contentHash: Buffer,
  opts: {
    chunkCount?: number;
    blobSize?: number;
    lastSig?: number[];
    mode?: number;
    contentType?: number;
  } = {}
): Promise<string> {
  const {
    chunkCount = 100,
    blobSize = 58500,
    lastSig = fakeSig(),
    mode = MODE_OPEN,
    contentType = CONTENT_TYPE_IMAGE,
  } = opts;

  const [pointerPDA] = findPointerPDA(contentHash, program.programId);

  return program.methods
    .createPointer(
      Array.from(contentHash) as any,
      inscriber.publicKey,
      chunkCount,
      blobSize,
      lastSig as any,
      mode,
      contentType
    )
    .accountsPartial({
      pointer: pointerPDA,
      payer: inscriber.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([inscriber])
    .rpc();
}

/** Helper: create pointer with separate payer and inscriber (e.g. node pays, artist is inscriber) */
async function createPointerWithPayer(
  program: Program<FdPointer>,
  payer: Keypair,
  inscriberPubkey: PublicKey,
  contentHash: Buffer,
  opts: {
    chunkCount?: number;
    blobSize?: number;
    lastSig?: number[];
    mode?: number;
    contentType?: number;
  } = {}
): Promise<string> {
  const {
    chunkCount = 100,
    blobSize = 58500,
    lastSig = fakeSig(),
    mode = MODE_OPEN,
    contentType = CONTENT_TYPE_IMAGE,
  } = opts;

  const [pointerPDA] = findPointerPDA(contentHash, program.programId);

  return program.methods
    .createPointer(
      Array.from(contentHash) as any,
      inscriberPubkey,
      chunkCount,
      blobSize,
      lastSig as any,
      mode,
      contentType
    )
    .accountsPartial({
      pointer: pointerPDA,
      payer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([payer])
    .rpc();
}

// (createPointerDelegated removed — delegated instruction no longer exists)

// ── Test suite ───────────────────────────────────────────────────────────

describe("fd_pointer", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.fdPointer as Program<FdPointer>;

  // Wallets
  const inscriber = Keypair.generate(); // artist wallet
  const inscriber2 = Keypair.generate(); // second artist
  const node = Keypair.generate(); // node operator
  const attacker = Keypair.generate(); // unauthorized wallet

  // Ed25519 keypairs (for delegated flow — NOT Solana wallets)
  const artistKeys = generateEd25519Keypair();
  const artistKeys2 = generateEd25519Keypair();

  // Content hashes for various test scenarios
  const artHash = sha256("beautiful-artwork-pixels-v1");
  const docHash = sha256("legal-contract-2026-final.pdf");
  const certHash = sha256("wine-bottle-certificate-chateau-margaux");
  const videoHash = sha256("artist-process-timelapse.mp4");
  const editionHash = sha256("10k-collection-base-image");
  const delegatedHash = sha256("node-inscribed-artwork");
  const delegatedHash2 = sha256("second-delegated-artwork");

  // ── Setup ────────────────────────────────────────────────────────────

  before(async () => {
    // Fund all test wallets
    await Promise.all([
      airdrop(provider.connection, inscriber.publicKey),
      airdrop(provider.connection, inscriber2.publicKey),
      airdrop(provider.connection, node.publicKey),
      airdrop(provider.connection, attacker.publicKey),
    ]);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 1. CREATE POINTER (Direct — inscriber signs live)
  // ════════════════════════════════════════════════════════════════════════

  describe("create_pointer (direct)", () => {
    it("creates a pointer PDA for artwork", async () => {
      const lastSig = fakeSig();
      const txSig = await createPointerDirect(program, provider, inscriber, artHash, {
        chunkCount: 2276,
        blobSize: 1331100,
        lastSig,
        mode: MODE_OPEN,
        contentType: CONTENT_TYPE_IMAGE,
      });

      // Fetch and verify all fields
      const [pointerPDA] = findPointerPDA(artHash, program.programId);
      const pointer = await program.account.pointer.fetch(pointerPDA);

      assert.deepEqual(Buffer.from(pointer.contentHash), artHash, "content_hash matches");
      assert.equal(
        pointer.inscriber.toBase58(),
        inscriber.publicKey.toBase58(),
        "inscriber matches signer"
      );
      assert.equal(
        pointer.collection.toBase58(),
        PublicKey.default.toBase58(),
        "collection starts as default"
      );
      assert.equal(pointer.chunkCount, 2276, "chunk_count matches");
      assert.equal(pointer.blobSize, 1331100, "blob_size matches");
      assert.deepEqual(
        Array.from(pointer.lastSig),
        lastSig,
        "last_sig matches"
      );
      assert.equal(pointer.mode, MODE_OPEN, "mode is open");
      assert.equal(pointer.contentType, CONTENT_TYPE_IMAGE, "content_type is image");
      assert.ok(pointer.slot.toNumber() > 0, "slot is set");
      assert.ok(pointer.timestamp.toNumber() > 0, "timestamp is set");
      assert.equal(
        pointer.primaryNft.toBase58(),
        PublicKey.default.toBase58(),
        "primary_nft starts as default"
      );
      assert.equal(pointer.version, 1, "version is 1");
      assert.ok(pointer.bump > 0, "bump is set");
    });

    it("creates a pointer for a document (certificate scenario)", async () => {
      await createPointerDirect(program, provider, inscriber, docHash, {
        chunkCount: 50,
        blobSize: 29250,
        mode: MODE_DIRECT,
        contentType: CONTENT_TYPE_DOCUMENT,
      });

      const [pointerPDA] = findPointerPDA(docHash, program.programId);
      const pointer = await program.account.pointer.fetch(pointerPDA);

      assert.equal(pointer.mode, MODE_DIRECT, "document mode is direct");
      assert.equal(pointer.contentType, CONTENT_TYPE_DOCUMENT, "content_type is document");
    });

    it("creates a pointer for a wine certificate (luxury auth scenario)", async () => {
      await createPointerDirect(program, provider, inscriber, certHash, {
        chunkCount: 10,
        blobSize: 5850,
        mode: MODE_OPEN,
        contentType: CONTENT_TYPE_CERTIFICATE,
      });

      const [pointerPDA] = findPointerPDA(certHash, program.programId);
      const pointer = await program.account.pointer.fetch(pointerPDA);

      assert.equal(pointer.contentType, CONTENT_TYPE_CERTIFICATE, "content_type is certificate");
      // Proves: who (inscriber = brand wallet), when (timestamp), what (cert hash)
      assert.equal(
        pointer.inscriber.toBase58(),
        inscriber.publicKey.toBase58(),
        "inscriber is the brand wallet"
      );
    });

    it("creates a pointer for encrypted content", async () => {
      const encHash = sha256("encrypted-private-art");
      await createPointerDirect(program, provider, inscriber, encHash, {
        chunkCount: 500,
        blobSize: 292500,
        mode: MODE_ENCRYPTED,
        contentType: CONTENT_TYPE_IMAGE,
      });

      const [pointerPDA] = findPointerPDA(encHash, program.programId);
      const pointer = await program.account.pointer.fetch(pointerPDA);
      assert.equal(pointer.mode, MODE_ENCRYPTED, "mode is encrypted");
    });

    it("creates a pointer for video content", async () => {
      await createPointerDirect(program, provider, inscriber2, videoHash, {
        chunkCount: 17000,
        blobSize: 9945000,
        mode: MODE_OPEN,
        contentType: CONTENT_TYPE_VIDEO,
      });

      const [pointerPDA] = findPointerPDA(videoHash, program.programId);
      const pointer = await program.account.pointer.fetch(pointerPDA);
      assert.equal(pointer.contentType, CONTENT_TYPE_VIDEO, "content_type is video");
      assert.equal(
        pointer.inscriber.toBase58(),
        inscriber2.publicKey.toBase58(),
        "different artist owns this pointer"
      );
    });

    // ── Edge cases ──────────────────────────────────────────────────────

    it("REJECTS duplicate content hash (first inscriber wins)", async () => {
      // artHash was already inscribed above — try again with different inscriber
      try {
        await createPointerDirect(program, provider, inscriber2, artHash, {
          chunkCount: 1,
          blobSize: 585,
        });
        assert.fail("Should have rejected duplicate hash");
      } catch (err: any) {
        // Anchor init constraint fails when account already exists
        assert.ok(
          err.toString().includes("already in use") ||
            err.toString().includes("0x0"),
          `Expected 'already in use' error, got: ${err.toString().slice(0, 200)}`
        );
      }
    });

    it("REJECTS zero chunk_count", async () => {
      const hash = sha256("zero-chunks-test");
      try {
        await createPointerDirect(program, provider, inscriber, hash, {
          chunkCount: 0,
          blobSize: 100,
        });
        assert.fail("Should have rejected zero chunks");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("ZeroChunks") ||
            err.toString().includes("Chunk count must be greater than zero"),
          `Expected ZeroChunks error, got: ${err.toString().slice(0, 200)}`
        );
      }
    });

    it("REJECTS zero blob_size", async () => {
      const hash = sha256("zero-blob-test");
      try {
        await createPointerDirect(program, provider, inscriber, hash, {
          chunkCount: 10,
          blobSize: 0,
        });
        assert.fail("Should have rejected zero blob_size");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("ZeroBlobSize") ||
            err.toString().includes("Blob size must be greater than zero"),
          `Expected ZeroBlobSize error, got: ${err.toString().slice(0, 200)}`
        );
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. CREATE POINTER DELEGATED (Node signs + Ed25519 proof)
  // ════════════════════════════════════════════════════════════════════════

  describe("create_pointer — node pays, artist is inscriber", () => {
    it("node pays rent, records artist as inscriber", async () => {
      const lastSig = fakeSig();
      // Node pays + signs, but passes inscriber (artist's wallet) as data
      await createPointerWithPayer(program, node, inscriber.publicKey, delegatedHash, {
        chunkCount: 876,
        blobSize: 512100,
        lastSig,
        mode: MODE_OPEN,
        contentType: CONTENT_TYPE_IMAGE,
      });

      const [pointerPDA] = findPointerPDA(delegatedHash, program.programId);
      const pointer = await program.account.pointer.fetch(pointerPDA);

      // Inscriber = artist (NOT the node that paid rent)
      assert.equal(
        pointer.inscriber.toBase58(),
        inscriber.publicKey.toBase58(),
        "inscriber is the artist, not the node"
      );
      assert.equal(pointer.chunkCount, 876);
      assert.equal(pointer.blobSize, 512100);
      assert.deepEqual(Array.from(pointer.lastSig), lastSig);
    });

    it("artist (not payer) can later call link_nft", async () => {
      // Set up: node creates PDA with a fresh artist as inscriber
      const artist2 = Keypair.generate();
      await airdrop(provider.connection, artist2.publicKey);
      const hash = sha256("node-pays-artist-links");
      await createPointerWithPayer(program, node, artist2.publicKey, hash);

      // Artist (not node) links an NFT — should succeed because pointer.inscriber == artist
      const [pointerPDA] = findPointerPDA(hash, program.programId);
      const nftMint = Keypair.generate().publicKey;
      await program.methods
        .linkNft(nftMint)
        .accountsPartial({ pointer: pointerPDA, inscriber: artist2.publicKey })
        .signers([artist2])
        .rpc();

      const pointer = await program.account.pointer.fetch(pointerPDA);
      assert.equal(pointer.primaryNft.toBase58(), nftMint.toBase58());
    });

    it("node CANNOT call link_nft (node is payer, not inscriber)", async () => {
      // delegatedHash was created with inscriber = main inscriber
      const [pointerPDA] = findPointerPDA(delegatedHash, program.programId);
      const nftMint = Keypair.generate().publicKey;
      try {
        await program.methods
          .linkNft(nftMint)
          .accountsPartial({ pointer: pointerPDA, inscriber: node.publicKey })
          .signers([node])
          .rpc();
        assert.fail("node should not be able to link");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("NotInscriber") ||
            err.toString().includes("not the inscriber"),
          `Expected NotInscriber, got: ${err.toString().slice(0, 200)}`
        );
      }
    });

    it("creates a second pointer with node paying for different artist", async () => {
      await createPointerWithPayer(program, node, inscriber2.publicKey, delegatedHash2, {
        chunkCount: 42,
        blobSize: 24570,
        contentType: CONTENT_TYPE_CERTIFICATE,
      });

      const [pointerPDA] = findPointerPDA(delegatedHash2, program.programId);
      const pointer = await program.account.pointer.fetch(pointerPDA);
      assert.equal(pointer.contentType, CONTENT_TYPE_CERTIFICATE);
      assert.equal(
        pointer.inscriber.toBase58(),
        inscriber2.publicKey.toBase58(),
        "inscriber is the second artist"
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. LINK NFT (one-shot, locks forever)
  // ════════════════════════════════════════════════════════════════════════

  describe("link_nft", () => {
    const nftMint = Keypair.generate().publicKey; // simulated NFT mint
    const nftMint2 = Keypair.generate().publicKey;

    it("inscriber links an NFT to their inscription", async () => {
      const [pointerPDA] = findPointerPDA(artHash, program.programId);

      await program.methods
        .linkNft(nftMint)
        .accounts({
          pointer: pointerPDA,
          inscriber: inscriber.publicKey,
        })
        .signers([inscriber])
        .rpc();

      const pointer = await program.account.pointer.fetch(pointerPDA);
      assert.equal(
        pointer.primaryNft.toBase58(),
        nftMint.toBase58(),
        "primary_nft is set"
      );
    });

    it("REJECTS linking a second NFT (already linked)", async () => {
      const [pointerPDA] = findPointerPDA(artHash, program.programId);

      try {
        await program.methods
          .linkNft(nftMint2)
          .accounts({
            pointer: pointerPDA,
            inscriber: inscriber.publicKey,
          })
          .signers([inscriber])
          .rpc();

        assert.fail("Should have rejected — already linked");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("AlreadyLinked") ||
            err.toString().includes("already been linked"),
          `Expected AlreadyLinked, got: ${err.toString().slice(0, 200)}`
        );
      }
    });

    it("REJECTS link_nft from non-inscriber (attacker)", async () => {
      // docHash was inscribed by inscriber — attacker tries to link
      const [pointerPDA] = findPointerPDA(docHash, program.programId);

      try {
        await program.methods
          .linkNft(nftMint)
          .accounts({
            pointer: pointerPDA,
            inscriber: attacker.publicKey,
          })
          .signers([attacker])
          .rpc();

        assert.fail("Should have rejected — not inscriber");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("NotInscriber") ||
            err.toString().includes("not the inscriber"),
          `Expected NotInscriber, got: ${err.toString().slice(0, 200)}`
        );
      }
    });

    it("inscriber links NFT to document inscription", async () => {
      const docNft = Keypair.generate().publicKey;
      const [pointerPDA] = findPointerPDA(docHash, program.programId);

      await program.methods
        .linkNft(docNft)
        .accounts({
          pointer: pointerPDA,
          inscriber: inscriber.publicKey,
        })
        .signers([inscriber])
        .rpc();

      const pointer = await program.account.pointer.fetch(pointerPDA);
      assert.equal(pointer.primaryNft.toBase58(), docNft.toBase58());
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. SET COLLECTION (one-shot, locks forever)
  // ════════════════════════════════════════════════════════════════════════

  describe("set_collection", () => {
    const collection = Keypair.generate().publicKey; // simulated Metaplex collection
    const collection2 = Keypair.generate().publicKey;

    it("inscriber sets collection on their inscription", async () => {
      const [pointerPDA] = findPointerPDA(artHash, program.programId);

      await program.methods
        .setCollection(collection)
        .accounts({
          pointer: pointerPDA,
          inscriber: inscriber.publicKey,
        })
        .signers([inscriber])
        .rpc();

      const pointer = await program.account.pointer.fetch(pointerPDA);
      assert.equal(
        pointer.collection.toBase58(),
        collection.toBase58(),
        "collection is set"
      );
    });

    it("REJECTS setting collection twice (already set)", async () => {
      const [pointerPDA] = findPointerPDA(artHash, program.programId);

      try {
        await program.methods
          .setCollection(collection2)
          .accounts({
            pointer: pointerPDA,
            inscriber: inscriber.publicKey,
          })
          .signers([inscriber])
          .rpc();

        assert.fail("Should have rejected — collection already set");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("CollectionAlreadySet") ||
            err.toString().includes("already been set"),
          `Expected CollectionAlreadySet, got: ${err.toString().slice(0, 200)}`
        );
      }
    });

    it("REJECTS set_collection from non-inscriber", async () => {
      const [pointerPDA] = findPointerPDA(certHash, program.programId);

      try {
        await program.methods
          .setCollection(collection)
          .accounts({
            pointer: pointerPDA,
            inscriber: attacker.publicKey,
          })
          .signers([attacker])
          .rpc();

        assert.fail("Should have rejected — not inscriber");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("NotInscriber") ||
            err.toString().includes("not the inscriber"),
          `Expected NotInscriber, got: ${err.toString().slice(0, 200)}`
        );
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. DISCOVERY PATTERNS (the whole point of the PDA)
  // ════════════════════════════════════════════════════════════════════════

  describe("discovery & lookups", () => {
    it("O(1) lookup by content hash — derive PDA, read it", async () => {
      // This is the core use case: "hash the artwork, find the proof"
      const [pointerPDA] = findPointerPDA(artHash, program.programId);
      const pointer = await program.account.pointer.fetch(pointerPDA);

      assert.ok(pointer, "PDA exists and is readable");
      assert.deepEqual(Buffer.from(pointer.contentHash), artHash);
      assert.equal(pointer.chunkCount, 2276);
    });

    it("O(1) lookup for non-existent hash returns null", async () => {
      const nonExistentHash = sha256("this-was-never-inscribed");
      const [pointerPDA] = findPointerPDA(nonExistentHash, program.programId);

      const pointer = await program.account.pointer.fetchNullable(pointerPDA);
      assert.isNull(pointer, "non-existent hash returns null");
    });

    it("finds all inscriptions by an artist (getProgramAccounts)", async () => {
      // Filter by inscriber field (offset: 8 discriminator + 32 content_hash = 40)
      const accounts = await program.account.pointer.all([
        {
          memcmp: {
            offset: 8 + 32, // after discriminator + content_hash
            bytes: inscriber.publicKey.toBase58(),
          },
        },
      ]);

      // inscriber created: artHash, docHash, certHash, encHash
      assert.isAtLeast(accounts.length, 4, "found all inscriptions by artist");

      // Verify all returned accounts belong to this inscriber
      for (const acc of accounts) {
        assert.equal(
          acc.account.inscriber.toBase58(),
          inscriber.publicKey.toBase58(),
          "all results belong to the inscriber"
        );
      }
    });

    it("finds all inscriptions in a collection (getProgramAccounts)", async () => {
      const collection = (
        await program.account.pointer.fetch(
          findPointerPDA(artHash, program.programId)[0]
        )
      ).collection;

      // Filter by collection field (offset: 8 + 32 + 32 = 72)
      const accounts = await program.account.pointer.all([
        {
          memcmp: {
            offset: 8 + 32 + 32, // after discriminator + content_hash + inscriber
            bytes: collection.toBase58(),
          },
        },
      ]);

      assert.isAtLeast(accounts.length, 1, "found inscription in collection");
      assert.equal(
        accounts[0].account.collection.toBase58(),
        collection.toBase58()
      );
    });

    it("finds inscription by primary NFT mint", async () => {
      // Get the NFT that was linked to artHash
      const artPointer = await program.account.pointer.fetch(
        findPointerPDA(artHash, program.programId)[0]
      );
      const linkedNft = artPointer.primaryNft;

      // Filter by primary_nft field
      // Offset: 8 disc + 32 hash + 32 inscriber + 32 collection + 4 chunk + 4 blob + 64 sig + 1 mode + 1 content_type + 8 slot + 8 timestamp = 194
      const accounts = await program.account.pointer.all([
        {
          memcmp: {
            offset: 8 + 32 + 32 + 32 + 4 + 4 + 64 + 1 + 1 + 8 + 8,
            bytes: linkedNft.toBase58(),
          },
        },
      ]);

      assert.equal(accounts.length, 1, "found exactly one inscription for this NFT");
      assert.deepEqual(
        Buffer.from(accounts[0].account.contentHash),
        artHash,
        "correct inscription found"
      );
    });

    it("lists ALL inscriptions (no filters)", async () => {
      const allAccounts = await program.account.pointer.all();
      // We created: artHash, docHash, certHash, encHash, videoHash, editionHash(?),
      //             delegatedHash, delegatedHash2
      assert.isAtLeast(allAccounts.length, 7, "all pointers are discoverable");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. REAL-WORLD SCENARIOS
  // ════════════════════════════════════════════════════════════════════════

  describe("real-world scenarios", () => {
    it("Scenario: Artist inscribes artwork, links NFT later", async () => {
      // Step 1: Artist inscribes (PDA created)
      const hash = sha256("monet-water-lilies-high-res");
      await createPointerDirect(program, provider, inscriber, hash, {
        chunkCount: 8500,
        blobSize: 4972500,
        contentType: CONTENT_TYPE_IMAGE,
      });

      // Step 2: Verify inscription exists
      const [pda] = findPointerPDA(hash, program.programId);
      let pointer = await program.account.pointer.fetch(pda);
      assert.equal(pointer.primaryNft.toBase58(), PublicKey.default.toBase58(), "no NFT yet");

      // Step 3: Days later, artist mints NFT and links it
      const nftMint = Keypair.generate().publicKey;
      await program.methods
        .linkNft(nftMint)
        .accounts({ pointer: pda, inscriber: inscriber.publicKey })
        .signers([inscriber])
        .rpc();

      pointer = await program.account.pointer.fetch(pda);
      assert.equal(pointer.primaryNft.toBase58(), nftMint.toBase58(), "NFT linked");
    });

    it("Scenario: Wine brand inscribes certificate, verifies by hash", async () => {
      // Brand inscribes the certificate image
      const certData = "chateau-margaux-2024-lot-4582-certificate-image";
      const hash = sha256(certData);

      await createPointerDirect(program, provider, inscriber, hash, {
        chunkCount: 15,
        blobSize: 8775,
        contentType: CONTENT_TYPE_CERTIFICATE,
      });

      // Customer scans QR code on bottle → gets the image → hashes it
      const customerHash = sha256(certData); // same data = same hash
      const [pda] = findPointerPDA(customerHash, program.programId);
      const pointer = await program.account.pointer.fetchNullable(pda);

      assert.ok(pointer, "Certificate found on-chain");
      assert.equal(
        pointer.inscriber.toBase58(),
        inscriber.publicKey.toBase58(),
        "Brand wallet is the inscriber — authentic"
      );
      assert.equal(pointer.contentType, CONTENT_TYPE_CERTIFICATE);
    });

    it("Scenario: Node inscribes for artist (node pays, artist is inscriber)", async () => {
      const hash = sha256("commissioned-portrait-final");
      const artist = Keypair.generate();
      await airdrop(provider.connection, artist.publicKey);

      // Artist paid to have inscription done
      // Node did all the inscription work + pays PDA rent
      // PDA records artist as inscriber (not the node)
      await createPointerWithPayer(program, node, artist.publicKey, hash, {
        chunkCount: 3000,
        blobSize: 1755000,
        contentType: CONTENT_TYPE_IMAGE,
      });

      const [pda] = findPointerPDA(hash, program.programId);
      const pointer = await program.account.pointer.fetch(pda);

      // The inscription belongs to the ARTIST, not the node
      assert.equal(pointer.inscriber.toBase58(), artist.publicKey.toBase58());
    });

    it("Scenario: 10k collection — editions share one inscription", async () => {
      // One base image inscribed
      const baseHash = sha256("degods-base-artwork-v2");
      await createPointerDirect(program, provider, inscriber, baseHash, {
        chunkCount: 2276,
        blobSize: 1331100,
        contentType: CONTENT_TYPE_IMAGE,
      });

      // Set the collection
      const degodsCollection = Keypair.generate().publicKey;
      const [pda] = findPointerPDA(baseHash, program.programId);
      await program.methods
        .setCollection(degodsCollection)
        .accounts({ pointer: pda, inscriber: inscriber.publicKey })
        .signers([inscriber])
        .rpc();

      // Link the primary/master NFT
      const masterNft = Keypair.generate().publicKey;
      await program.methods
        .linkNft(masterNft)
        .accounts({ pointer: pda, inscriber: inscriber.publicKey })
        .signers([inscriber])
        .rpc();

      const pointer = await program.account.pointer.fetch(pda);
      assert.equal(pointer.collection.toBase58(), degodsCollection.toBase58());
      assert.equal(pointer.primaryNft.toBase58(), masterNft.toBase58());

      // Each of the 10k edition NFTs would store baseHash in their
      // Metaplex attributes → derive this same PDA → O(1) verification
      // We don't need 10k PDAs — just one, and 10k NFTs pointing to it
    });

    it("Scenario: Verify artwork NOT inscribed (returns null)", async () => {
      // Someone checks if a random image is freeze-dried
      const randomImage = sha256("random-internet-meme-not-inscribed");
      const [pda] = findPointerPDA(randomImage, program.programId);

      const result = await program.account.pointer.fetchNullable(pda);
      assert.isNull(result, "Not inscribed — null result");
    });

    it("Scenario: Two artists, same collection (multi-artist collection)", async () => {
      const hash1 = sha256("artist-a-piece-for-collab");
      const hash2 = sha256("artist-b-piece-for-collab");
      const collabCollection = Keypair.generate().publicKey;

      // Artist 1 inscribes their piece
      await createPointerDirect(program, provider, inscriber, hash1, {
        chunkCount: 500,
        blobSize: 292500,
        contentType: CONTENT_TYPE_IMAGE,
      });

      // Artist 2 inscribes their piece
      await createPointerDirect(program, provider, inscriber2, hash2, {
        chunkCount: 600,
        blobSize: 351000,
        contentType: CONTENT_TYPE_IMAGE,
      });

      // Both set the same collection
      const [pda1] = findPointerPDA(hash1, program.programId);
      const [pda2] = findPointerPDA(hash2, program.programId);

      await program.methods
        .setCollection(collabCollection)
        .accounts({ pointer: pda1, inscriber: inscriber.publicKey })
        .signers([inscriber])
        .rpc();

      await program.methods
        .setCollection(collabCollection)
        .accounts({ pointer: pda2, inscriber: inscriber2.publicKey })
        .signers([inscriber2])
        .rpc();

      // Query collection — should find both
      const collectionAccounts = await program.account.pointer.all([
        {
          memcmp: {
            offset: 8 + 32 + 32,
            bytes: collabCollection.toBase58(),
          },
        },
      ]);

      assert.equal(
        collectionAccounts.length,
        2,
        "both artists' work found in the collection"
      );
    });

    it("Scenario: Timestamp proves existence at specific time", async () => {
      const hash = sha256("legal-filing-evidence-2026");
      const beforeTime = Math.floor(Date.now() / 1000);

      await createPointerDirect(program, provider, inscriber, hash, {
        chunkCount: 30,
        blobSize: 17550,
        contentType: CONTENT_TYPE_DOCUMENT,
      });

      const [pda] = findPointerPDA(hash, program.programId);
      const pointer = await program.account.pointer.fetch(pda);

      // Timestamp proves the document was inscribed around this time
      const onChainTime = pointer.timestamp.toNumber();
      assert.isAtLeast(onChainTime, beforeTime - 10, "timestamp is recent");
      assert.isAtMost(
        onChainTime,
        beforeTime + 30,
        "timestamp is not in the future"
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7. IMMUTABILITY GUARANTEES
  // ════════════════════════════════════════════════════════════════════════

  describe("immutability guarantees", () => {
    it("content_hash cannot be changed after creation", async () => {
      // There's no update instruction — this is verified by the absence
      // of any instruction that could modify content_hash.
      // The only way to "change" it would be to close and recreate,
      // but there's no close instruction either.
      const [pda] = findPointerPDA(artHash, program.programId);
      const pointer = await program.account.pointer.fetch(pda);
      assert.deepEqual(
        Buffer.from(pointer.contentHash),
        artHash,
        "content_hash is immutable"
      );
    });

    it("inscriber field cannot be changed after creation", async () => {
      const [pda] = findPointerPDA(artHash, program.programId);
      const pointer = await program.account.pointer.fetch(pda);
      assert.equal(
        pointer.inscriber.toBase58(),
        inscriber.publicKey.toBase58(),
        "inscriber is immutable"
      );
    });

    it("primary_nft is locked after being set", async () => {
      // artHash already has primary_nft set — verify it can't change
      const [pda] = findPointerPDA(artHash, program.programId);
      const pointer = await program.account.pointer.fetch(pda);
      assert.notEqual(
        pointer.primaryNft.toBase58(),
        PublicKey.default.toBase58(),
        "primary_nft is set"
      );
      // The AlreadyLinked test above proves it can't be changed
    });

    it("collection is locked after being set", async () => {
      const [pda] = findPointerPDA(artHash, program.programId);
      const pointer = await program.account.pointer.fetch(pda);
      assert.notEqual(
        pointer.collection.toBase58(),
        PublicKey.default.toBase58(),
        "collection is set"
      );
      // The CollectionAlreadySet test above proves it can't be changed
    });

    it("no instruction exists to close/delete a pointer", async () => {
      // Verify by checking the IDL — only 4 instructions exist
      const idl = program.idl;
      const instructionNames = idl.instructions.map((ix: any) => ix.name);

      // Anchor IDL uses camelCase for instruction names
      assert.deepEqual(
        instructionNames.sort(),
        [
          "createPointer",
          "linkNft",
          "setCollection",
        ].sort(),
        "only 3 instructions exist — no close, no update, no admin"
      );
    });
  });
});
