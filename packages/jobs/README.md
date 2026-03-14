# @freezedry/jobs

On-chain inscription job marketplace client for the [FreezeDry Protocol](https://github.com/freezedry-protocol/freezedry-protocol).

Read job PDAs, create inscription jobs, and track status — all client-side with no server dependency.

## Install

```bash
npm install @freezedry/jobs @solana/web3.js
```

## Quick Start

```ts
import {
  fetchConfig, fetchOpenJobs, buildCreateJobTx, calculateEscrow,
} from '@freezedry/jobs';
import { Connection } from '@solana/web3.js';

const rpcUrl = 'https://api.mainnet-beta.solana.com';

// Read protocol config
const config = await fetchConfig(rpcUrl);
console.log('Min escrow:', config.minEscrowLamports, 'lamports');
console.log('Fee split:', config.inscriberFeeBps, '/', config.treasuryFeeBps);

// Check open jobs
const jobs = await fetchOpenJobs(rpcUrl);
console.log(`${jobs.length} jobs waiting for inscribers`);

// Calculate cost for a blob
const escrow = calculateEscrow(blobSizeBytes, config);
console.log(`${escrow.chunkCount} chunks, ${escrow.lamports} lamports`);

// Build a create_job transaction (user signs with wallet)
const tx = await buildCreateJobTx({
  connection: new Connection(rpcUrl),
  creator: wallet.publicKey,
  contentHash: 'sha256:abc123...',
  chunkCount: escrow.chunkCount,
  escrowLamports: escrow.lamports,
  blobSource: 'https://cdn.example.com/blob/sha256:abc123...',
});

// Sign + send
const signed = await wallet.signTransaction(tx);
const sig = await connection.sendRawTransaction(signed.serialize());
```

## Job Lifecycle

```
Open → Claimed → Submitted → Completed
  │                              ↑
  │    (failed attestation) ─────┘ (requeued)
  │
  └→ Cancelled (creator cancel)
  └→ Expired (timeout, escrow refunded)
```

1. **Creator** calls `create_job` with escrow SOL + content hash
2. **Writer node** claims the job, inscribes memo TXs, submits receipt
3. **Reader node** verifies inscription, submits attestation
4. **Anyone** triggers `release_payment` once quorum reached
5. Escrow splits: inscriber / attester / treasury / referrer

## On-Chain Program

- **Program ID:** `AmqBYKYCqpmKoFcgvripCQ3bJC2d8ygWWhcoHtmTvvzx`
- **Network:** Solana Mainnet
- **Config PDA:** `7kzBVepD19Bs983BcKK9ufvWYoHDwxsSGWFfwFJDLPZK`

## API

### `fetchConfig(rpcUrl, programId?)`
Read the global Config PDA. Returns fee splits, min escrow, attestation requirements.

### `fetchJob(rpcUrl, jobId, programId?)`
Fetch a single job by ID.

### `fetchAllJobs(rpcUrl, programId?)`
Fetch all job PDAs via `getProgramAccounts`.

### `fetchOpenJobs(rpcUrl, programId?)`
Fetch jobs with status `open`, sorted FIFO by jobId.

### `fetchJobAttestations(rpcUrl, jobId, programId?)`
Fetch all attestation PDAs for a job.

### `buildCreateJobTx(opts)`
Build an unsigned `create_job` transaction.
- **opts.connection** — Solana Connection
- **opts.creator** — Creator public key (fee payer)
- **opts.contentHash** — SHA-256 hash of the blob
- **opts.chunkCount** — Number of memo chunks
- **opts.escrowLamports** — SOL to escrow
- **opts.referrer** — Referrer public key (optional)
- **opts.assignedNode** — Preferred writer node (optional)
- **opts.exclusiveWindow** — Seconds of exclusive claim time (optional)
- **opts.blobSource** — URL where nodes can fetch the blob (optional)

### `calculateEscrow(blobSize, config)`
Calculate chunk count and minimum escrow for a given blob size.

### PDA Derivation
- `deriveConfigPDA(programId?)` — `["fd-config"]`
- `deriveJobPDA(jobId, programId?)` — `["fd-job", jobId.to_le_bytes()]`
- `deriveAttestationPDA(jobId, reader, programId?)` — `["fd-attest", jobId, reader]`
- `deriveReferrerPDA(wallet, programId?)` — `["fd-referrer", wallet]`

## License

MIT
