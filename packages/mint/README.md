# @freezedry/mint

Mint Metaplex Core NFTs with embedded FreezeDry manifests. Part of the [FreezeDry Protocol](https://github.com/freezedry-protocol/freezedry-protocol).

Upload functions are dependency-injected — use Arweave, IPFS, S3, or any storage backend.

## Install

```bash
npm install @freezedry/mint @metaplex-foundation/mpl-core @metaplex-foundation/umi @solana/web3.js
```

## Quick Start

```ts
import { mintNFT } from '@freezedry/mint';

const result = await mintNFT({
  blob: hydBlob,           // .hyd blob
  manifest: {              // from @freezedry/solana buildManifest()
    hash: 'sha256:abc...',
    signatures: ['sig1', 'sig2', ...],
    chunkCount: 42,
    blobSize: 24600,
  },
  wallet: phantomWallet,   // any Solana wallet adapter
  rpc: 'https://mainnet.helius-rpc.com/?api-key=...',

  // You provide the upload functions — not locked to any storage
  uploadPreview: async (bytes, contentType) => {
    // Upload preview image to Arweave, IPFS, S3, etc.
    return 'https://arweave.net/...';
  },
  uploadMetadata: async (bytes, contentType) => {
    return 'https://arweave.net/...';
  },

  onProgress: (step, pct) => console.log(step, pct),
});

console.log('NFT:', result.nftAddress);
console.log('Image:', result.imageUri);
console.log('Metadata:', result.metadataUri);
```

## What It Does

1. **Extracts** a preview image from the `.hyd` blob for display
2. **Uploads** preview image via your `uploadPreview` function
3. **Builds** Metaplex-standard metadata JSON with FreezeDry attributes
4. **Uploads** metadata via your `uploadMetadata` function
5. **Mints** a Metaplex Core NFT with the metadata URI

The NFT metadata includes:
- Protocol, mode, chunk count, dimensions as on-chain attributes
- `properties.hydrate_manifest` with hash + signatures for reconstruction

## Update Existing NFTs

```ts
import { updateNFT } from '@freezedry/mint';

const result = await updateNFT({
  nftAddress: 'ABC123...',
  manifest: { hash, signatures, chunkCount, blobSize },
  wallet: phantomWallet,
  rpc: rpcUrl,
  uploadMetadata: async (bytes, type) => '...',
});
```

Adds FreezeDry manifest to any existing Metaplex Core NFT you own.

## API

### `mintNFT(opts)`
Mint a new NFT with embedded manifest.
- **opts.blob** — `.hyd` blob bytes
- **opts.manifest** — `{ hash, signatures, chunkCount, blobSize }`
- **opts.wallet** — Solana wallet adapter
- **opts.rpc** — RPC endpoint URL
- **opts.uploadPreview** — `(bytes, contentType) => Promise<string>`
- **opts.uploadMetadata** — `(bytes, contentType) => Promise<string>`
- **opts.name** — NFT name (default: `"FreezeDry #{hash}"`)
- **opts.width/height** — Dimensions for attributes
- **opts.mode** — `'open'` | `'encrypted'`
- Returns `{ nftAddress, imageUri, metadataUri }`

### `updateNFT(opts)`
Add manifest to an existing NFT.
- Returns `{ nftAddress, metadataUri, txSignature }`

### `extractPreview(blob)`
Extract preview image bytes from a `.hyd` blob. Returns `null` for encrypted blobs.

## License

MIT
