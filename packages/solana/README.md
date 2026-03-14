# @freezedry/solana

Solana memo storage for the [FreezeDry Protocol](https://github.com/freezedry-protocol/freezedry-protocol).

Shred blobs into memo transactions, send them on-chain, and read them back. Everything you need to inscribe and retrieve data on Solana.

## Install

```bash
npm install @freezedry/solana @solana/web3.js
```

## Quick Start

```ts
import {
  shred, buildMemoTxs, confirmBatch, fetchBlob,
  estimateCost, buildManifest, MEMO_CHUNK_SIZE,
} from '@freezedry/solana';
import { Connection } from '@solana/web3.js';

const rpcUrl = 'https://api.mainnet-beta.solana.com';

// 1. Estimate cost
const cost = estimateCost(blob.byteLength);
console.log(`${cost.chunks} chunks, ~${cost.sol} SOL`);

// 2. Shred blob into 585-byte chunks
const { chunks, manifestHash } = shred(blob);

// 3. Build unsigned memo transactions
const conn = new Connection(rpcUrl);
const { blockhash } = await conn.getLatestBlockhash();

const txs = buildMemoTxs(chunks, {
  payer: wallet.publicKey,
  blockhash,
  manifestHash,
});

// 4. Sign with your wallet
const signed = await wallet.signAllTransactions(txs);

// 5. Send + confirm
const sigs = [];
for (const tx of signed) {
  const sig = await conn.sendRawTransaction(tx.serialize());
  sigs.push(sig);
}
const result = await confirmBatch(rpcUrl, sigs);
console.log(`${result.confirmed.length} confirmed`);

// 6. Build pointer memo (metadata TX)
const pointer = buildPointerMemo({
  manifestHash,
  chunkCount: chunks.length,
  blobSize: blob.byteLength,
  inscriber: wallet.publicKey.toBase58(),
  lastChunkSig: sigs[sigs.length - 1],
});

// 7. Read back from chain later
const recovered = await fetchBlob(rpcUrl, sigs, {
  onProgress: (pct) => console.log(`${pct}% fetched`),
});
```

## Memo Protocol (v3)

Each memo transaction contains one chunk:

```
FD:{hash8}:{index}:{base64data}
```

- **hash8** — First 8 hex chars of the manifest hash
- **index** — Zero-padded chunk index
- **base64data** — 585 bytes of blob data, base64-encoded

Pointer memo (metadata):
```
FREEZEDRY:3:{hash}:{chunkCount}:{blobSize}:{chunkSize}:{flags}:{inscriber}:{lastSig}
```

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MEMO_CHUNK_SIZE` | 600 | Total bytes per memo TX |
| `V3_HEADER_SIZE` | 15 | Header overhead per chunk |
| `MEMO_PAYLOAD_SIZE` | 585 | Usable payload per chunk |

## API

### `shred(blob)`
Split blob into 585-byte chunks with v3 headers.
Returns `{ chunks: Uint8Array[], manifestHash: string }`

### `buildMemoTxs(chunks, opts)`
Build unsigned Solana transactions (one per chunk).
- **opts.payer** — Fee payer public key
- **opts.blockhash** — Recent blockhash
- **opts.manifestHash** — Hash prefix for chunk headers
- **opts.priorityFee** — Compute unit price (default: auto)

### `buildPointerMemo(opts)`
Build the metadata pointer transaction.

### `confirmBatch(rpcUrl, signatures, opts?)`
Poll signature statuses until all confirmed.
Returns `{ confirmed: string[], failed: string[] }`

### `fetchBlob(rpcUrl, signatures, opts?)`
Reconstruct blob from on-chain memo transactions.
- **opts.concurrency** — Parallel fetches (default: 5)
- **opts.onProgress** — Progress callback

### `estimateCost(blobSize, solPrice?)`
Calculate chunk count and estimated SOL cost.

### `checkAlreadyInscribed(hash, opts?)`
Check if a hash is already inscribed (dedup before creating jobs).
- **opts.registryUrl** — Registry API (default: `https://freezedry.art`)
- **opts.cdnUrl** — CDN endpoint (default: `https://cdn.freezedry.art`)

### `reassemble(chunks)`
Reassemble ordered chunks back into original blob.

## License

MIT
