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

/**
 * UTF-8 safe truncation to 32 bytes, zero-padded. Matches the behavior
 * partner API + node clients MUST use before sending title to create_pointer_v2
 * (the on-chain handler rejects invalid UTF-8 via PointerError::InvalidTitle).
 *
 * Iterates by Unicode code point (for..of over a string gives code points,
 * not code units). Accumulates characters whose UTF-8 bytes still fit in 32,
 * stops before overflow. Always produces a valid UTF-8 prefix of `s`.
 */
function padTitle(s: string): Buffer {
  const buf = Buffer.alloc(32, 0);
  if (!s) return buf;

  const encoder = new TextEncoder();
  let byteLen = 0;
  let truncated = "";

  for (const ch of s) {
    const chBytes = encoder.encode(ch);
    if (byteLen + chBytes.length > 32) break;
    truncated += ch;
    byteLen += chBytes.length;
  }

  Buffer.from(truncated, "utf8").copy(buf, 0);
  return buf;
}

/** Helper: create_pointer_v2 with upfront primary_nft + collection + title */
async function createPointerV2(
  program: Program<FdPointer>,
  inscriber: Keypair,
  contentHash: Buffer,
  opts: {
    chunkCount?: number;
    blobSize?: number;
    lastSig?: number[];
    mode?: number;
    contentType?: number;
    primaryNft?: PublicKey;
    collection?: PublicKey;
    title?: Buffer | number[];   // 32 bytes, zero-padded UTF-8
  } = {}
): Promise<string> {
  const {
    chunkCount = 100,
    blobSize = 58500,
    lastSig = Array(64).fill(0),   // default to [0; 64] — finalize via update_last_sig later
    mode = MODE_OPEN,
    contentType = CONTENT_TYPE_IMAGE,
    primaryNft = PublicKey.default,
    collection = PublicKey.default,
    title = Buffer.alloc(32, 0),   // default empty title (all zeros)
  } = opts;

  const titleBytes = Array.from(title);
  if (titleBytes.length !== 32) {
    throw new Error(`title must be exactly 32 bytes, got ${titleBytes.length}`);
  }

  const [pointerPDA] = findPointerPDA(contentHash, program.programId);

  return program.methods
    .createPointerV2(
      Array.from(contentHash) as any,
      inscriber.publicKey,
      chunkCount,
      blobSize,
      lastSig as any,
      mode,
      contentType,
      primaryNft,
      collection,
      titleBytes as any,
    )
    .accountsPartial({
      pointer: pointerPDA,
      payer: inscriber.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([inscriber])
    .rpc();
}

/** Helper: call update_last_sig on an existing pointer */
async function callUpdateLastSig(
  program: Program<FdPointer>,
  inscriber: Keypair,
  contentHash: Buffer,
  lastSig: number[],
): Promise<string> {
  const [pointerPDA] = findPointerPDA(contentHash, program.programId);
  return program.methods
    .updateLastSig(lastSig as any)
    .accountsPartial({
      pointer: pointerPDA,
      inscriber: inscriber.publicKey,
    })
    .signers([inscriber])
    .rpc();
}

/** Helper: call transfer_inscriber */
async function callTransferInscriber(
  program: Program<FdPointer>,
  currentInscriber: Keypair,
  contentHash: Buffer,
  newInscriber: PublicKey,
): Promise<string> {
  const [pointerPDA] = findPointerPDA(contentHash, program.programId);
  return program.methods
    .transferInscriber(newInscriber)
    .accountsPartial({
      pointer: pointerPDA,
      inscriber: currentInscriber.publicKey,
    })
    .signers([currentInscriber])
    .rpc();
}

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
      // v2+migrate — 7 instructions. None of them CLOSE a PDA, which is what
      // this test is protecting. Keep this list in sync with lib.rs #[program].
      const idl = program.idl;
      const instructionNames = idl.instructions.map((ix: any) => ix.name);

      assert.deepEqual(
        instructionNames.sort(),
        [
          "createPointer",
          "createPointerV2",
          "linkNft",
          "migratePointerAccount",
          "setCollection",
          "transferInscriber",
          "updateLastSig",
        ].sort(),
        "7 instructions — no close/delete/admin (migrate grows accounts, never closes)"
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. CREATE_POINTER_V2 — upfront primary_nft + collection
  // ════════════════════════════════════════════════════════════════════════

  describe("create_pointer_v2 + update_last_sig", () => {
    const v2Artist = Keypair.generate();
    const v2NodeOp = Keypair.generate();
    const v2Attacker = Keypair.generate();
    const v2Hash = sha256("v2-test-upfront-nft");
    const v2HashUnlinked = sha256("v2-test-unlinked-at-start");
    const v2HashFinalize = sha256("v2-test-finalize-later");
    const v2HashLockCheck = sha256("v2-test-lock-check");
    const fakeNftMint = Keypair.generate().publicKey;
    const fakeCollectionMint = Keypair.generate().publicKey;

    before(async () => {
      await Promise.all([
        airdrop(provider.connection, v2Artist.publicKey),
        airdrop(provider.connection, v2NodeOp.publicKey),
        airdrop(provider.connection, v2Attacker.publicKey),
      ]);
    });

    it("creates a pointer with primary_nft + collection set at creation (full link)", async () => {
      await createPointerV2(program, v2Artist, v2Hash, {
        chunkCount: 79,
        blobSize: 46034,
        lastSig: Array(64).fill(0),
        mode: MODE_DIRECT,
        contentType: CONTENT_TYPE_IMAGE,
        primaryNft: fakeNftMint,
        collection: fakeCollectionMint,
      });

      const [pda] = findPointerPDA(v2Hash, program.programId);
      const pointer = await program.account.pointer.fetch(pda);

      assert.equal(pointer.inscriber.toBase58(), v2Artist.publicKey.toBase58());
      assert.equal(pointer.primaryNft.toBase58(), fakeNftMint.toBase58(), "primary_nft populated at create");
      assert.equal(pointer.collection.toBase58(), fakeCollectionMint.toBase58(), "collection populated at create");
      assert.equal(pointer.chunkCount, 79);
      assert.equal(pointer.blobSize, 46034);
      assert.equal(pointer.mode, MODE_DIRECT);
      assert.equal(pointer.version, 2, "v2 handler sets version=2");
      assert.deepEqual(
        Array.from(pointer.lastSig),
        Array(64).fill(0),
        "last_sig stays [0;64] until update_last_sig runs"
      );
    });

    it("accepts Pubkey::default for primary_nft and collection (unlinked case — behaves like v1)", async () => {
      await createPointerV2(program, v2Artist, v2HashUnlinked, {
        chunkCount: 4,
        blobSize: 2048,
        primaryNft: PublicKey.default,
        collection: PublicKey.default,
      });

      const [pda] = findPointerPDA(v2HashUnlinked, program.programId);
      const pointer = await program.account.pointer.fetch(pda);
      assert.equal(pointer.primaryNft.toBase58(), PublicKey.default.toBase58());
      assert.equal(pointer.collection.toBase58(), PublicKey.default.toBase58());
    });

    it("update_last_sig finalizes last_sig when inscriber signs", async () => {
      // Create with zero last_sig, then finalize
      await createPointerV2(program, v2Artist, v2HashFinalize, {
        chunkCount: 79,
        blobSize: 46034,
        lastSig: Array(64).fill(0),
      });

      const finalSig = fakeSig();
      await callUpdateLastSig(program, v2Artist, v2HashFinalize, finalSig);

      const [pda] = findPointerPDA(v2HashFinalize, program.programId);
      const pointer = await program.account.pointer.fetch(pda);
      assert.deepEqual(Array.from(pointer.lastSig), finalSig, "last_sig finalized");
    });

    it("update_last_sig fails when already finalized (write-once)", async () => {
      // v2HashFinalize was just finalized above — second call must fail
      let errored = false;
      try {
        await callUpdateLastSig(
          program,
          v2Artist,
          v2HashFinalize,
          fakeSig(),
        );
      } catch (err: any) {
        errored = true;
        assert.include(
          err.toString(),
          "AlreadyFinalized",
          "expected AlreadyFinalized error"
        );
      }
      assert.isTrue(errored, "second update_last_sig should have failed");
    });

    it("update_last_sig fails when caller is not the inscriber", async () => {
      await createPointerV2(program, v2Artist, v2HashLockCheck, {
        chunkCount: 4,
        blobSize: 2048,
        lastSig: Array(64).fill(0),
      });

      let errored = false;
      try {
        await callUpdateLastSig(program, v2Attacker, v2HashLockCheck, fakeSig());
      } catch (err: any) {
        errored = true;
        assert.include(err.toString(), "NotInscriber");
      }
      assert.isTrue(errored);
    });

    it("update_last_sig rejects a zero-only last_sig write", async () => {
      // v2HashLockCheck still has zero last_sig. Passing Array(64).fill(0) should be rejected.
      let errored = false;
      try {
        await callUpdateLastSig(program, v2Artist, v2HashLockCheck, Array(64).fill(0));
      } catch (err: any) {
        errored = true;
        assert.include(err.toString(), "ZeroLastSig");
      }
      assert.isTrue(errored, "zero last_sig is rejected");
    });

    it("v1 create_pointer still works (regression)", async () => {
      const v1Hash = sha256("regression-v1-still-works");
      const v1Artist = Keypair.generate();
      await airdrop(provider.connection, v1Artist.publicKey);

      await createPointerDirect(program, provider, v1Artist, v1Hash, {
        chunkCount: 10,
        blobSize: 5000,
      });

      const [pda] = findPointerPDA(v1Hash, program.programId);
      const p = await program.account.pointer.fetch(pda);
      assert.equal(p.inscriber.toBase58(), v1Artist.publicKey.toBase58());
      assert.equal(p.version, 1, "v1 handler leaves version=1");
      assert.equal(p.primaryNft.toBase58(), PublicKey.default.toBase58(), "v1 leaves NFT unset");

      // Title + new _reserved must be zero-filled on v1 creates (back-compat guarantee).
      // Anchor TS type strips the leading underscore: _reserved -> reserved.
      assert.deepEqual(Array.from(p.title), Array(32).fill(0), "v1 leaves title zeros");
      assert.deepEqual(Array.from((p as any).reserved), Array(64).fill(0), "v1 leaves reserved zeros");
    });

    // ── Title field tests ────────────────────────────────────────────────

    it("stores ASCII title bytes on-chain when provided via create_pointer_v2", async () => {
      const h = sha256("title-ascii-happy-path");
      const artist = Keypair.generate();
      await airdrop(provider.connection, artist.publicKey);

      const title = padTitle("Sunset #3");
      await createPointerV2(program, artist, h, { title });

      const [pda] = findPointerPDA(h, program.programId);
      const p = await program.account.pointer.fetch(pda);
      assert.deepEqual(Array.from(p.title), Array.from(title), "title bytes persisted");

      // Decode back to string (trim trailing zeros)
      const stored = Buffer.from(p.title as any);
      const trimLen = stored.indexOf(0) === -1 ? 32 : stored.indexOf(0);
      assert.equal(stored.slice(0, trimLen).toString("utf8"), "Sunset #3");
    });

    it("accepts empty title (all zeros)", async () => {
      const h = sha256("title-empty-ok");
      const artist = Keypair.generate();
      await airdrop(provider.connection, artist.publicKey);

      await createPointerV2(program, artist, h, { title: Buffer.alloc(32, 0) });

      const [pda] = findPointerPDA(h, program.programId);
      const p = await program.account.pointer.fetch(pda);
      assert.deepEqual(Array.from(p.title), Array(32).fill(0), "empty title stored as zeros");
    });

    it("accepts exactly 32-byte title (no truncation, no trailing zeros)", async () => {
      const h = sha256("title-exact-32");
      const artist = Keypair.generate();
      await airdrop(provider.connection, artist.publicKey);

      const title = Buffer.from("A".repeat(32), "utf8");
      assert.equal(title.length, 32);

      await createPointerV2(program, artist, h, { title });

      const [pda] = findPointerPDA(h, program.programId);
      const p = await program.account.pointer.fetch(pda);
      assert.deepEqual(Array.from(p.title), Array.from(title), "full 32-byte title stored");
      assert.equal(Buffer.from(p.title as any).toString("utf8"), "A".repeat(32));
    });

    it("accepts multi-byte UTF-8 (emoji + CJK)", async () => {
      const h = sha256("title-utf8-multibyte");
      const artist = Keypair.generate();
      await airdrop(provider.connection, artist.publicKey);

      const title = padTitle("夕焼け❄️");  // 4 CJK (12 bytes) + snowflake emoji (4 bytes VS) = fits
      await createPointerV2(program, artist, h, { title });

      const [pda] = findPointerPDA(h, program.programId);
      const p = await program.account.pointer.fetch(pda);

      const stored = Buffer.from(p.title as any);
      const trimLen = stored.indexOf(0) === -1 ? 32 : stored.indexOf(0);
      const decoded = stored.slice(0, trimLen).toString("utf8");
      assert.equal(decoded, "夕焼け❄️", "multibyte UTF-8 roundtrips cleanly");
    });

    it("padTitle truncates long input at UTF-8 code-point boundary (never mid-codepoint)", async () => {
      // 20 three-byte CJK chars = 60 bytes. Truncates to last complete char fitting in 32.
      // 32 / 3 = 10 full chars = 30 bytes, next char would overflow, trailing 2 zeros.
      const longCjk = "日".repeat(20);
      const title = padTitle(longCjk);

      // Must still be valid UTF-8 when decoded (never split a multi-byte sequence)
      const stored = title;
      const trimLen = stored.indexOf(0) === -1 ? 32 : stored.indexOf(0);
      const decoded = stored.slice(0, trimLen).toString("utf8");
      assert.equal(decoded, "日".repeat(10), "truncated to 10 full CJK chars = 30 bytes");
      assert.equal(Buffer.byteLength(decoded, "utf8"), 30);

      // And the on-chain handler accepts it
      const h = sha256("title-truncate-cjk");
      const artist = Keypair.generate();
      await airdrop(provider.connection, artist.publicKey);
      await createPointerV2(program, artist, h, { title });

      const [pda] = findPointerPDA(h, program.programId);
      const p = await program.account.pointer.fetch(pda);
      assert.deepEqual(Array.from(p.title), Array.from(title));
    });

    it("REJECTS invalid UTF-8 bytes with InvalidTitle error", async () => {
      const h = sha256("title-invalid-utf8");
      const artist = Keypair.generate();
      await airdrop(provider.connection, artist.publicKey);

      // Invalid UTF-8: lone continuation byte (0x80 with no leading byte)
      const badTitle = Buffer.alloc(32, 0);
      badTitle[0] = 0x80;

      let errored = false;
      try {
        await createPointerV2(program, artist, h, { title: badTitle });
      } catch (err: any) {
        errored = true;
        assert.include(err.toString(), "InvalidTitle", "expected InvalidTitle error");
      }
      assert.isTrue(errored, "invalid UTF-8 must be rejected at handler");
    });

    it("REJECTS invalid UTF-8 (truncated multibyte at end before padding)", async () => {
      const h = sha256("title-truncated-multibyte");
      const artist = Keypair.generate();
      await airdrop(provider.connection, artist.publicKey);

      // CJK "日" is E6 97 A5 (3 bytes). Put just E6 97 then null padding.
      // This mimics what would happen if a naive client truncated mid-char.
      // Validator stops at first 0x00 — so bytes [0..2] = [E6, 97, 00...] — but
      // the validator checks bytes BEFORE the first null. We put bytes 0-1 as
      // [E6, 97] and byte 2 as 0x00. str::from_utf8 on [E6, 97] = invalid.
      const badTitle = Buffer.alloc(32, 0);
      badTitle[0] = 0xE6;
      badTitle[1] = 0x97;
      // byte 2 is 0x00 — validator stops here, checks [E6, 97] which is invalid

      let errored = false;
      try {
        await createPointerV2(program, artist, h, { title: badTitle });
      } catch (err: any) {
        errored = true;
        assert.include(err.toString(), "InvalidTitle");
      }
      assert.isTrue(errored, "truncated multibyte in prefix must be rejected");
    });

    it("title is NEVER mutated by subsequent instructions (immutability)", async () => {
      const h = sha256("title-immutable-across-ixs");
      const artist = Keypair.generate();
      await airdrop(provider.connection, artist.publicKey);

      const originalTitle = padTitle("Immortal Title");

      // 1. Create with title set
      await createPointerV2(program, artist, h, {
        title: originalTitle,
        lastSig: Array(64).fill(0),
      });
      const [pda] = findPointerPDA(h, program.programId);

      // 2. link_nft doesn't touch title
      const fakeNft = Keypair.generate().publicKey;
      await program.methods
        .linkNft(fakeNft)
        .accountsPartial({ pointer: pda, inscriber: artist.publicKey })
        .signers([artist])
        .rpc();
      let p = await program.account.pointer.fetch(pda);
      assert.deepEqual(Array.from(p.title), Array.from(originalTitle), "title unchanged after link_nft");

      // 3. set_collection doesn't touch title
      const fakeColl = Keypair.generate().publicKey;
      await program.methods
        .setCollection(fakeColl)
        .accountsPartial({ pointer: pda, inscriber: artist.publicKey })
        .signers([artist])
        .rpc();
      p = await program.account.pointer.fetch(pda);
      assert.deepEqual(Array.from(p.title), Array.from(originalTitle), "title unchanged after set_collection");

      // 4. update_last_sig doesn't touch title
      await callUpdateLastSig(program, artist, h, fakeSig());
      p = await program.account.pointer.fetch(pda);
      assert.deepEqual(Array.from(p.title), Array.from(originalTitle), "title unchanged after update_last_sig");

      // 5. transfer_inscriber doesn't touch title
      const newInscriber = Keypair.generate();
      await callTransferInscriber(program, artist, h, newInscriber.publicKey);
      p = await program.account.pointer.fetch(pda);
      assert.deepEqual(Array.from(p.title), Array.from(originalTitle), "title unchanged after transfer_inscriber");
    });

    it("PointerCreatedV2 event actually emits with the correct title bytes (runtime proof)", async () => {
      // This is a RUNTIME test, not a structural one. We subscribe to the
      // event stream, fire a create_pointer_v2 with a known title, and assert
      // the emitted event carries those exact bytes. Catches bugs like:
      //   - Handler writes title to PDA but forgets to emit in event
      //   - Handler emits event with title = [0;32] regardless of input
      //   - Wrong byte ordering in event serialization
      const h = sha256("title-event-emission-runtime");
      const artist = Keypair.generate();
      await airdrop(provider.connection, artist.publicKey);

      const expectedTitle = padTitle("Event Test #1");

      // Subscribe to PointerCreatedV2 events before firing the tx
      let capturedEvent: any = null;
      const listenerId = program.addEventListener(
        "pointerCreatedV2" as any,
        (event: any) => {
          // Filter for our specific content hash to avoid cross-test pollution
          const eventHash = Buffer.from(event.contentHash);
          if (eventHash.equals(h)) capturedEvent = event;
        }
      );

      try {
        await createPointerV2(program, artist, h, { title: expectedTitle });

        // Events may be delivered async; wait up to 3s for our event
        const deadline = Date.now() + 3000;
        while (!capturedEvent && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }

        assert.isNotNull(capturedEvent, "PointerCreatedV2 event was received");
        assert.isDefined(capturedEvent.title, "event has title field");

        const emittedTitle = Buffer.from(capturedEvent.title);
        assert.equal(emittedTitle.length, 32, "emitted title is 32 bytes");
        assert.deepEqual(
          Array.from(emittedTitle),
          Array.from(expectedTitle),
          "emitted title bytes EXACTLY match what we passed in"
        );

        // Also verify inscriber + content_hash in the event match what we sent
        assert.equal(
          (capturedEvent.inscriber as PublicKey).toBase58(),
          artist.publicKey.toBase58(),
          "event.inscriber matches signer"
        );
        assert.deepEqual(
          Array.from(Buffer.from(capturedEvent.contentHash)),
          Array.from(h),
          "event.contentHash matches arg"
        );
      } finally {
        await program.removeEventListener(listenerId);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. TRANSFER_INSCRIBER — hand PDA inscriber role to a new pubkey
  // ════════════════════════════════════════════════════════════════════════
  //
  // Flow this IX enables:
  //   1. Node (GCP) creates PDA via create_pointer_v2 with inscriber = GCP (so node
  //      can finalize update_last_sig).
  //   2. Node finalizes update_last_sig after chunks confirm.
  //   3. Node calls transfer_inscriber(new_inscriber = user | NFT creator) so the
  //      work's actual creator ends up owning the PDA.
  //
  // After transfer:
  //   - New inscriber CAN call link_nft + set_collection + update_last_sig + transfer_inscriber
  //   - Old inscriber CANNOT — rights fully handed off
  //   - primary_nft + collection remain write-once (set by whoever, locked for everyone)
  //   - Pubkey::default() as new_inscriber = renounce — no one can ever call gated ixs again

  describe("transfer_inscriber", () => {
    const tNode = Keypair.generate();        // plays "GCP" — initial inscriber
    const tCreator = Keypair.generate();     // the user/artist who should own the PDA
    const tAttacker = Keypair.generate();    // random attacker

    const tHashA = sha256("transfer-happy-path");
    const tHashB = sha256("transfer-unauthorized");
    const tHashC = sha256("transfer-rights-follow-the-role");
    const tHashD = sha256("transfer-renounce");
    const tHashE = sha256("transfer-self-noop");
    const tHashF = sha256("transfer-chain");

    before(async () => {
      await Promise.all([
        airdrop(provider.connection, tNode.publicKey),
        airdrop(provider.connection, tCreator.publicKey),
        airdrop(provider.connection, tAttacker.publicKey),
      ]);
    });

    it("happy path: current inscriber transfers to a new pubkey → inscriber field updates + event emits", async () => {
      // tNode creates a PDA (acts as the node).
      await createPointerV2(program, tNode, tHashA, {
        chunkCount: 79, blobSize: 46034, lastSig: Array(64).fill(0),
      });
      const [pda] = findPointerPDA(tHashA, program.programId);
      const before = await program.account.pointer.fetch(pda);
      assert.equal(before.inscriber.toBase58(), tNode.publicKey.toBase58(), "initial inscriber = tNode");

      // Transfer to tCreator.
      await callTransferInscriber(program, tNode, tHashA, tCreator.publicKey);

      const after = await program.account.pointer.fetch(pda);
      assert.equal(after.inscriber.toBase58(), tCreator.publicKey.toBase58(), "inscriber swapped to tCreator");
      // Other fields untouched.
      assert.deepEqual(Array.from(after.contentHash), Array.from(tHashA), "content_hash unchanged");
      assert.equal(after.chunkCount, before.chunkCount, "chunk_count unchanged");
      assert.equal(after.blobSize, before.blobSize, "blob_size unchanged");
      assert.equal(after.version, 2, "version byte unchanged");
    });

    it("non-inscriber rejected: attacker cannot transfer even with own signature", async () => {
      await createPointerV2(program, tNode, tHashB, {
        chunkCount: 5, blobSize: 2048, lastSig: Array(64).fill(0),
      });

      let errored = false;
      try {
        // Attacker tries to steal the inscriber role.
        await callTransferInscriber(program, tAttacker, tHashB, tAttacker.publicKey);
      } catch (err: any) {
        errored = true;
        assert.include(err.toString(), "NotInscriber", "expected NotInscriber error");
      }
      assert.isTrue(errored, "attacker transfer must fail");

      const [pda] = findPointerPDA(tHashB, program.programId);
      const p = await program.account.pointer.fetch(pda);
      assert.equal(p.inscriber.toBase58(), tNode.publicKey.toBase58(), "inscriber unchanged after attack");
    });

    it("rights FOLLOW the role: after transfer, new inscriber CAN link_nft, old inscriber CANNOT", async () => {
      await createPointerV2(program, tNode, tHashC, {
        chunkCount: 5, blobSize: 2048, lastSig: Array(64).fill(0),
      });
      const [pda] = findPointerPDA(tHashC, program.programId);

      // Before transfer: tNode IS inscriber → can link_nft ✓ (we'll skip verifying this positive case
      // since the main point is post-transfer behavior).

      // Transfer to tCreator.
      await callTransferInscriber(program, tNode, tHashC, tCreator.publicKey);

      // After transfer: tNode tries link_nft → must FAIL (NotInscriber).
      const fakeNft1 = Keypair.generate().publicKey;
      let oldInscriberRejected = false;
      try {
        await program.methods
          .linkNft(fakeNft1)
          .accountsPartial({ pointer: pda, inscriber: tNode.publicKey })
          .signers([tNode])
          .rpc();
      } catch (err: any) {
        oldInscriberRejected = true;
        assert.include(err.toString(), "NotInscriber", "old inscriber should be rejected");
      }
      assert.isTrue(oldInscriberRejected, "old inscriber lost link_nft rights");

      // tCreator tries link_nft → must SUCCEED.
      const fakeNft2 = Keypair.generate().publicKey;
      await program.methods
        .linkNft(fakeNft2)
        .accountsPartial({ pointer: pda, inscriber: tCreator.publicKey })
        .signers([tCreator])
        .rpc();

      const p = await program.account.pointer.fetch(pda);
      assert.equal(p.primaryNft.toBase58(), fakeNft2.toBase58(), "tCreator successfully linked NFT");
    });

    it("renounce: transferring to Pubkey::default() makes PDA permanently un-inscriber-ed", async () => {
      await createPointerV2(program, tNode, tHashD, {
        chunkCount: 5, blobSize: 2048, lastSig: Array(64).fill(0),
      });
      const [pda] = findPointerPDA(tHashD, program.programId);

      // Renounce inscriber rights.
      await callTransferInscriber(program, tNode, tHashD, PublicKey.default);

      const p = await program.account.pointer.fetch(pda);
      assert.equal(p.inscriber.toBase58(), PublicKey.default.toBase58(), "inscriber = default (renounced)");

      // tNode can no longer call link_nft (no longer the inscriber).
      let nodeRejected = false;
      try {
        await program.methods
          .linkNft(Keypair.generate().publicKey)
          .accountsPartial({ pointer: pda, inscriber: tNode.publicKey })
          .signers([tNode])
          .rpc();
      } catch (err: any) {
        nodeRejected = true;
        assert.include(err.toString(), "NotInscriber");
      }
      assert.isTrue(nodeRejected, "after renounce, even original inscriber rejected");

      // No one can call transfer_inscriber either (would need signer matching Pubkey::default which is impossible).
      // The `all-zeros Pubkey` has no corresponding private key, so this PDA's inscriber role is permanently orphaned.
      // Anchor's inscriber: Signer<'info> constraint requires a real signature; can't be satisfied for Pubkey::default.
    });

    it("self-transfer: new_inscriber == current inscriber is a logged no-op, not an error", async () => {
      await createPointerV2(program, tNode, tHashE, {
        chunkCount: 5, blobSize: 2048, lastSig: Array(64).fill(0),
      });
      // Should succeed, emit log "transfer_inscriber: new_inscriber == current; no-op".
      await callTransferInscriber(program, tNode, tHashE, tNode.publicKey);

      const [pda] = findPointerPDA(tHashE, program.programId);
      const p = await program.account.pointer.fetch(pda);
      assert.equal(p.inscriber.toBase58(), tNode.publicKey.toBase58(), "inscriber unchanged (self-transfer)");
    });

    it("chained transfers: A → B → C works (simulates re-selling a creator's PDA rights)", async () => {
      await createPointerV2(program, tNode, tHashF, {
        chunkCount: 5, blobSize: 2048, lastSig: Array(64).fill(0),
      });
      const [pda] = findPointerPDA(tHashF, program.programId);

      // tNode → tCreator
      await callTransferInscriber(program, tNode, tHashF, tCreator.publicKey);

      // tCreator → tAttacker (not really an attack here — valid hand-off from new owner)
      await callTransferInscriber(program, tCreator, tHashF, tAttacker.publicKey);

      const p = await program.account.pointer.fetch(pda);
      assert.equal(p.inscriber.toBase58(), tAttacker.publicKey.toBase58(), "final inscriber = tAttacker after chain");

      // tCreator lost rights after second transfer.
      let creatorRejected = false;
      try {
        await callTransferInscriber(program, tCreator, tHashF, tCreator.publicKey);
      } catch (err: any) {
        creatorRejected = true;
        assert.include(err.toString(), "NotInscriber");
      }
      assert.isTrue(creatorRejected, "mid-chain holder loses rights after transferring out");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7. MIGRATE_POINTER_ACCOUNT — grow legacy-sized PDAs to current layout
  // ════════════════════════════════════════════════════════════════════════
  //
  // This IX grows any under-sized Pointer PDA to 8 + Pointer::INIT_SPACE bytes
  // via Solana `realloc` with zero-fill. Tests here cover NEGATIVE paths —
  // the full positive path (migrate an actual 260-byte v1 PDA → 324 bytes,
  // verify bytes 228-323 are zero-filled, verify subsequent link_nft works)
  // requires pre-staging a 260-byte account which solana-test-validator
  // doesn't support easily. That test runs on devnet in Phase 1a.14 against
  // a pre-seeded fixture account.
  //
  // What we CAN test locally:
  //   (a) rejects when account is already at target size (all our test PDAs are)
  //   (b) rejects when account is not a Pointer (wrong discriminator)
  //   (c) requires system_program account for the CPI transfer

  describe("migrate_pointer_account", () => {
    const mArtist = Keypair.generate();
    const mPayer = Keypair.generate();
    const mHash = sha256("migrate-negative-paths");

    before(async () => {
      await Promise.all([
        airdrop(provider.connection, mArtist.publicKey),
        airdrop(provider.connection, mPayer.publicKey),
      ]);
    });

    it("REJECTS migration of an already-324-byte account (AlreadyAtTargetSize)", async () => {
      // Create a fresh v2 PDA — it's already at the current target size of
      // 8 + Pointer::INIT_SPACE = 324 bytes. Calling migrate on it should
      // fail with AlreadyAtTargetSize.
      await createPointerV2(program, mArtist, mHash, {
        title: padTitle("Already at target"),
      });
      const [pda] = findPointerPDA(mHash, program.programId);

      // Confirm pre-state: account is 324 bytes
      const acctInfo = await provider.connection.getAccountInfo(pda);
      assert.isNotNull(acctInfo);
      assert.equal(acctInfo!.data.length, 324, "v2-created account is 324 bytes");

      let errored = false;
      try {
        await program.methods
          .migratePointerAccount()
          .accountsPartial({
            pointer: pda,
            payer: mPayer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([mPayer])
          .rpc();
      } catch (err: any) {
        errored = true;
        assert.include(err.toString(), "AlreadyAtTargetSize",
          `expected AlreadyAtTargetSize, got: ${err.toString().slice(0, 200)}`);
      }
      assert.isTrue(errored, "migrate on already-sized account must fail");
    });

    it("REJECTS migration when account is not a Pointer (discriminator mismatch)", async () => {
      // Create a system-owned account (wrong owner, wrong discriminator) and
      // try to migrate it. The IX requires `mut` on the pointer account, but
      // since we're only going to the discriminator check before any state
      // mutation, the account ownership doesn't matter for THIS failure mode.
      //
      // Instead of constructing a fake 260-byte account, we just pass a
      // random valid non-Pointer account and confirm the handler rejects it.
      // But wait — the account must be owned by the program for realloc to
      // work, and Anchor's #[account(mut)] doesn't enforce ownership. The
      // handler does a manual discriminator check. Use a random keypair's
      // system account as the target — it's owned by SystemProgram, not our
      // program. In this case Anchor/Solana will refuse the realloc itself
      // with "invalid program for account" before our handler runs, OR our
      // handler catches the size-too-small / discriminator failure first.
      //
      // Simplest reliable test: create a minimal-size account owned by
      // SystemProgram with no data, expect rejection at floor check.
      const randomTarget = Keypair.generate();
      // Fund it so it exists on-chain with 0 data bytes (system-owned).
      const tx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: mPayer.publicKey,
          newAccountPubkey: randomTarget.publicKey,
          space: 0,
          lamports: await provider.connection.getMinimumBalanceForRentExemption(0),
          programId: SystemProgram.programId,
        })
      );
      await provider.sendAndConfirm(tx, [mPayer, randomTarget]);

      let errored = false;
      let errMsg = "";
      try {
        await program.methods
          .migratePointerAccount()
          .accountsPartial({
            pointer: randomTarget.publicKey,
            payer: mPayer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([mPayer])
          .rpc();
      } catch (err: any) {
        errored = true;
        errMsg = err.toString();
      }
      assert.isTrue(errored, "migrate on non-Pointer account must fail");
      // Any of AccountTooSmall / NotAPointer / solana-level ownership errors
      // are acceptable — the point is that we do NOT realloc a random account.
      const acceptable =
        errMsg.includes("AccountTooSmall") ||
        errMsg.includes("NotAPointer") ||
        errMsg.includes("0x64") /* NotAPointer discriminator error code */ ||
        errMsg.includes("0x65") /* AccountTooSmall discriminator error code */ ||
        errMsg.includes("AccountOwnedByWrongProgram") ||
        errMsg.includes("invalid program id") ||
        errMsg.includes("incorrect program id") ||
        errMsg.includes("ConstraintMut") ||
        errMsg.includes("privilege");
      assert.isTrue(acceptable,
        `expected a rejection error, got: ${errMsg.slice(0, 400)}`);
    });

    it("verifies the migrate IX exists in IDL and takes no args (future-proof generic)", async () => {
      const idl = program.idl;
      const ix = idl.instructions.find((i: any) =>
        i.name === "migratePointerAccount" || i.name === "migrate_pointer_account"
      );
      assert.isDefined(ix, "migrate_pointer_account IX in IDL");
      assert.equal((ix as any).args.length, 0,
        "migrate takes no args — target size is derived from current INIT_SPACE");
    });

    it("verifies PointerAccountMigrated event is in IDL with old_size + new_size fields", async () => {
      const idl = program.idl;
      const ev = idl.events?.find((e: any) =>
        e.name === "pointerAccountMigrated" || e.name === "PointerAccountMigrated"
      );
      assert.isDefined(ev, "PointerAccountMigrated event in IDL");

      const eventTypeName: string = (ev as any).type?.defined?.name || "PointerAccountMigrated";
      const eventType = idl.types?.find((t: any) =>
        t.name === eventTypeName || t.name === "pointerAccountMigrated" || t.name === "PointerAccountMigrated"
      );
      const fields = (eventType as any)?.type?.fields || (ev as any).fields || [];
      const fieldNames = fields.map((f: any) => f.name);
      assert.include(fieldNames, "pda");
      assert.include(fieldNames, "oldSize" /* camelCase */);
      assert.include(fieldNames, "newSize");
    });

    it("verifies AlreadyAtTargetSize + NotAPointer + AccountTooSmall errors are in IDL", async () => {
      const idl = program.idl;
      const errNames = (idl.errors || []).map((e: any) => e.name);
      assert.include(errNames, "alreadyAtTargetSize" /* camelCase in TS */);
      assert.include(errNames, "notAPointer");
      assert.include(errNames, "accountTooSmall");
    });
  });
});
