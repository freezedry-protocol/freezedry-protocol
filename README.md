# FreezeDry Protocol (FDP)

On-chain art storage for Solana. Preserve any file into a `.hyd` blob, inscribe it permanently in Solana memo transactions, and reconstruct the exact original — bit for bit.

**Full app**: [freezedry.art](https://freezedry.art) — managed inscriptions, NFT minting, and fast hydration.

## How It Works

Raw file bytes are stored directly on-chain. No lossy compression, no intermediate formats. The original data is preserved exactly as-is, verified by SHA-256 hash.

```
File → Preserve (.hyd) → Shred (585B chunks) → Inscribe (Solana memos) → Hydrate (reconstruct)
```

1. **Preserve** — File → `.hyd` blob with 49-byte header (magic, mode, dimensions, hash)
2. **Shred** — `.hyd` blob → 585-byte chunks with v3 self-identifying headers (`FD:{hash8}:{index}:{base64}`)
3. **Inscribe** — Chunks → Solana memo transactions (permanent on-chain storage)
4. **Pointer** — `FREEZEDRY:3:{hash}:{chunks}:{size}:{chunkSize}:{flags}:{inscriber}:{lastSig}` memo for discovery
5. **Hydrate** — Signatures → fetch memos → reassemble `.hyd` blob → verify SHA-256 → restore original

Supports open and encrypted inscription modes. Encrypted blobs (AES-256-GCM) are indistinguishable from random noise on-chain — only the password holder can reconstruct.

## Standalone Tools

Self-contained HTML files that work forever — no servers, no installs, just a browser and Solana. See [`tools/README.md`](tools/README.md) for full documentation.

### `tools/freezedry-standalone.html` — Inscribe + Hydrate (recommended)

**Zero external dependencies.** Inscribe any file to Solana and reconstruct from chain — all in one file using only browser-native Web Crypto APIs.

- BIP39 burner wallet with PIN-encrypted localStorage (Phantom-compatible seed phrase)
- Open and encrypted inscription modes
- Pointer Lookup — one signature recovers everything
- NFT Lookup — reads inscriptionHash from Metaplex Core NFTs via DAS
- Checkpoint resume — survives tab close, browser crash, power outage
- Fund reclaim — send remaining SOL back when done
- SHA-256 integrity verification on hydration

**Open the file directly in your browser** — no build step, no npm install, no server, no wallet extension.

### Legacy: `tools/hydrate.html` / `tools/dehydrate.html`

Original standalone tools. Still work, but superseded by `freezedry-standalone.html`.

## Packages (SDK)

For building applications on top of the protocol:

| Package | Description | Dependencies |
|---|---|---|
| [`@freezedry/compress`](packages/compress/) | Preserve + hydrate engine | Zero chain deps |
| [`@freezedry/solana`](packages/solana/) | Shred + Inscribe + Chain reads | `@solana/web3.js` |
| [`@freezedry/jobs`](packages/jobs/) | Inscription job marketplace client | `@solana/web3.js` |
| [`@freezedry/mint`](packages/mint/) | Metaplex Core NFT minting | Metaplex + Solana |
| [`@freezedry/registry`](packages/registry/) | Node registry reader | `@solana/web3.js` |

### Usage

```ts
import { wrap, unwrap } from '@freezedry/compress';
import { shred, buildMemoTxs, estimateCost } from '@freezedry/solana';

// 1. Preserve file into .hyd blob
const { blob, hash } = await wrap(fileBytes, {
  mode: 'open',        // or 'encrypted' with password
  width: 0,            // 0 for non-image files
  height: 0,
});

// 2. Estimate cost
const cost = estimateCost(blob.byteLength);
console.log(`${cost.chunkCount} txs, ~$${cost.usdCost.toFixed(4)}`);

// 3. Shred + build transactions
const chunks = shred(blob);
const txs = buildMemoTxs(chunks, {
  payer: wallet.publicKey,
  blockhash: recentBlockhash,
});

// 4. Hydrate back to original
const original = await unwrap(blob);
console.log('Hash:', original.hash); // sha256:...
```

## .hyd Blob Format

```
Offset  Size  Field
0-3     4B    Magic: 0x48 0x59 0x44 0x01 ("HYD\x01")
4       1B    Mode: 3=direct open, 5=direct encrypted
5-6     2B    Width (uint16 LE) — 0 for non-image files
7-8     2B    Height (uint16 LE) — 0 for non-image files
9-12    4B    Reserved (uint32 LE, 0)
13-16   4B    File length (uint32 LE)
17-48   32B   SHA-256 hash of original data
49+     var   Raw file bytes (open) or AES-256-GCM ciphertext (encrypted)
```

## v3 Chunk Format

Each memo transaction carries a chunk with 585 bytes of payload data:

```
FD:{hash8}:{index}:{base64data}
|   |       |       └── 585 bytes of .hyd blob data, base64 encoded
|   |       └── 2-digit chunk index (00, 01, ..., 99, 100, ...)
|   └── First 8 hex chars of manifest SHA-256
└── Self-identifying prefix (15B header overhead)
```

## Development

```bash
npm install        # Install all workspace dependencies
npm run build      # Build all packages (ESM + CJS + types)
npm run clean      # Clean dist/ in all packages
```

## On-Chain Programs (Anchor)

| Program | ID | Description |
|---------|-----|-------------|
| `freezedry-jobs` | `AmqBYKYCqpmKoFcgvripCQ3bJC2d8ygWWhcoHtmTvvzx` | Inscription job marketplace — escrow, attestation, payment |
| `freezedry-registry` | `6UGJUc28AuCj8a8sjhsVEKbvYHfQECCuJC7i54vk2to` | Node registry — writers, readers, heartbeats, stake |
| `freezedry-pod` | `2hTh2yTcXhxEvz3hFAhGiUNm2eQoEvQvrAn5C1aNkm2W` | Proof of Delivery (devnet) |

97 passing tests. Build + test:

```bash
cargo-build-sbf --manifest-path programs/inscription-jobs/Cargo.toml
cargo-build-sbf --manifest-path programs/node-registry/Cargo.toml
anchor test
```

## Architecture

```
freezedry-protocol/
  packages/
    compress/     @freezedry/compress — preserve/hydrate engine, zero chain deps
    solana/       @freezedry/solana  — Solana memo storage
    jobs/         @freezedry/jobs    — job marketplace client
    mint/         @freezedry/mint    — Metaplex NFT minting
    registry/     @freezedry/registry — node registry client
  programs/
    inscription-jobs/   — Anchor program (escrow, attestation, fees)
    node-registry/      — Anchor program (nodes, heartbeats, stake)
    pod/                — Anchor program (proof of delivery)
  tools/
    freezedry-standalone.html  — inscribe + hydrate (zero deps, recommended)
    hydrate.html               — legacy hydrator (read-only)
    dehydrate.html             — legacy dehydrator (Phantom + web3.js)
  examples/
    inscribe.html              — DIY demo (preserve → inscribe → hydrate, TX fees only)
    inscribe-marketplace.html  — Protocol demo (escrow job → node inscribes → verified)
```

## Related

- [Free Tools](https://freezedry.art/tools) — Standalone inscriber, RPC calculator, embed widget, and more
- [freezedry-node](https://github.com/freezedry-protocol/freezedry-node) — Run your own indexer/cache node
- [freezedry.art](https://freezedry.art) — Full app with managed infrastructure

## License

MIT
