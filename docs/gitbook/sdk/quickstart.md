# Quick Start

Get started with the FreezeDry SDK in a few minutes. Works in the browser (no bundler) or Node.js.

## Install

```bash
npm install @freezedry/compress @freezedry/solana @freezedry/jobs
```

### Browser (no bundler)

```javascript
import { wrap, unwrap } from 'https://esm.sh/@freezedry/compress@0.1.0?bundle';
import { shred, buildMemoTxs, confirmBatch, fetchBlob, estimateCost }
  from 'https://esm.sh/@freezedry/solana@0.1.0?bundle';
```

## Preserve a File

```javascript
// Wrap any file into a .hyd blob
const blob = wrap(fileBytes, { mode: 'open' });

// Estimate cost
const cost = estimateCost(blob.byteLength);
console.log(`${cost.chunks} chunks, ~${cost.sol.toFixed(6)} SOL`);
```

## Shred and Inscribe

```javascript
// Split blob into 585-byte chunks
const chunks = shred(blob);

// Build memo transactions
const txs = buildMemoTxs(chunks, { payer, blockhash, manifestHash });

// Sign + send + confirm
const signatures = []; // collect from sendRawTransaction
const result = await confirmBatch(rpcUrl, signatures);
```

## Reconstruct from Chain

```javascript
// Later: reconstruct from chain using TX signatures
const recovered = await fetchBlob(rpcUrl, signatures);
const originalFile = unwrap(recovered);
```

## Encrypted Inscription

```javascript
// Encrypt before inscribing — indistinguishable from noise on-chain
const blob = wrap(fileBytes, { mode: 'encrypted', password: 'mypassword' });

// To reconstruct:
const recovered = await fetchBlob(rpcUrl, signatures);
const originalFile = unwrap(recovered, 'mypassword');
```

## SDK Packages

| Package | Purpose |
|---------|---------|
| `@freezedry/compress` | Preserve files into .hyd blobs, hydrate back. Open + encrypted modes. |
| `@freezedry/solana` | Shred blobs into chunks, build memo TXs, confirm batches, fetch from chain |
| `@freezedry/jobs` | Jobs program client — create/fetch jobs, calculate escrow, derive PDAs |
| `@freezedry/registry` | Registry program client — fetch nodes, derive PDAs, display names |
| `@freezedry/mint` | Metaplex Core NFT minting with manifest attributes |

## Standalone Tool

Don't want to write code? Use the [standalone tool](https://freezedry.art/tools) — a single HTML file that inscribes any file to Solana and reconstructs from chain. Zero dependencies, works offline (except RPC calls).
