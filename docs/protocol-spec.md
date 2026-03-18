# FreezeDry Protocol Specification

## Overview

FreezeDry inscribes files directly to the Solana blockchain using memo transactions. The complete file — every byte — lives on-chain. If every server, CDN, and frontend disappears, the data survives and can be reconstructed from the ledger alone.

## .hyd Blob Format (49-byte header)

All files are preserved into a `.hyd` blob before inscription. The header is fixed at 49 bytes, little-endian.

```
Offset  Size   Field              Description
──────  ─────  ─────────────────  ──────────────────────────────────────
0-2     3B     Magic              "HYD" (0x48 0x59 0x44)
3       1B     Version            0x01
4       1B     Mode               3 = direct open, 5 = direct encrypted
5-6     2B     Width              u16 LE (0 for non-image files)
7-8     2B     Height             u16 LE (0 for non-image files)
9-12    4B     Reserved           u32 LE (0)
13-16   4B     File Length         u32 LE (original file size in bytes)
17-48   32B    SHA-256 Hash       Content hash (zeroed for encrypted mode)
49+     var    Body               Raw file bytes (open) or AES-256-GCM ciphertext (encrypted)
```

### Modes

| Mode | Value | Description |
|------|-------|-------------|
| Direct Open | 3 | Header readable, file bytes follow header in cleartext |
| Direct Encrypted | 5 | 5-byte header only (magic + mode), rest is AES-256-GCM ciphertext |

**Encrypted mode details:**
- Key derivation: PBKDF2 (600K iterations, SHA-256) from user password
- Encryption: AES-256-GCM
- Ciphertext layout: salt (16B) + IV (12B) + encrypted(width + height + reserved + fileLen + SHA-256 + file bytes) + auth tag (16B)
- No metadata exposed — file type, size, and content are indistinguishable from random noise

### Width/Height

- Image files: actual pixel dimensions
- Non-image files: width=0, height=0 (signals hydrator to offer download instead of render)

## Memo Chunk Format (v3)

The blob is split into 585-byte chunks, base64-encoded, and written to Solana memo transactions.

```
FD:{hash8}:{index}:{base64data}
```

| Field | Size | Description |
|-------|------|-------------|
| `FD:` | 3 chars | Protocol prefix |
| `hash8` | 8 chars | First 8 hex chars of manifest SHA-256 (no `sha256:` prefix) |
| `index` | 2+ chars | Zero-padded chunk index ("00", "01", ...) |
| `base64data` | ~780 chars | Base64-encoded 585-byte raw chunk |

**Total per memo TX:** ~795 bytes (within Solana's 1,232 byte limit)

### Constants

```
MEMO_CHUNK_SIZE    = 600    (header + payload)
MEMO_PAYLOAD_SIZE  = 585    (raw bytes per chunk)
V3_HEADER_SIZE     = 15     (FD:{hash8}:{idx}:)
MEMO_PROGRAM_ID    = MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr
```

### Chunk Count

```
chunk_count = ceil(blob_bytes / 585)
```

Example: a 5 MB file produces a ~5 MB blob (49B header + file), requiring `ceil(5,242,929 / 585) = 8,963` memo transactions.

## Pointer Memo (v3)

After all chunks are confirmed, a single pointer memo is sent. This is the index — anyone can find all chunks from the pointer alone.

```
FREEZEDRY:3:{hash}:{chunkCount}:{blobSize}:{chunkSize}:{flags}:{inscriber}:{lastSig}[:{configPDA}]
```

| Field | Required | Description |
|-------|----------|-------------|
| `hash` | Yes | Full manifest hash (`sha256:abcdef...`) |
| `chunkCount` | Yes | Number of chunks inscribed |
| `blobSize` | Yes | Total blob size in bytes |
| `chunkSize` | Yes | 585 (constant, for verification) |
| `flags` | Yes | Content type + encryption mode flags |
| `inscriber` | Yes | First 8 chars of inscriber's wallet address |
| `lastSig` | Yes | TX signature of the last chunk (for ordering/discovery) |
| `configPDA` | No | Jobs program Config PDA address. Present when written by marketplace nodes; omitted for direct inscriptions. |

## Reconstruction (Hydration)

Three ways to reconstruct a file from chain:

### 1. From Signatures
Provide the JSON array of all chunk TX signatures. Fetch each TX, extract memo data, decode base64, reassemble in order.

### 2. From Pointer
Provide one pointer TX signature:
1. Fetch the pointer TX → parse `FREEZEDRY:3:` memo
2. Extract hash, chunk count, and inscriber wallet
3. Scan inscriber's TX history via `getSignaturesForAddress`
4. Match memos containing `FD:{hash8}:` prefix
5. Sort by chunk index → decode → reassemble

### 3. From NFT
Provide a Metaplex Core NFT mint address:
1. Call DAS `getAsset` → read `inscriptionHash` attribute
2. Find pointer memo in the inscription authority's TX history
3. Chain into pointer resolve (method 2 above)

## Fee Economics (v3)

### Escrow Formula

```
escrow = max(min_escrow, chunks × 7,500 lamports)
```

- `min_escrow`: 15,385,000 lamports (~$2 USD floor)
- Rate: 7,500 lamports/chunk (5,000 TX reimbursement + 2,500 margin)

### Two-Step Payment Split

On job completion, escrow is split in two steps:

**Step 1 — TX Reimbursement (pass-through):**
```
reimbursement = chunks × base_tx_fee (5,000 lamports)
```
Paid entirely to the writer. Covers actual Solana TX costs.

**Step 2 — Margin Split (by BPS):**
```
margin = escrow - reimbursement
```
Split by basis points locked at job creation:

| Recipient | BPS | % | Per-chunk (at 7,500/chunk) |
|-----------|-----|---|---------------------------|
| Writer | 4,000 | 40% | 1,000 lamports |
| Attester | 1,000 | 10% | 250 lamports |
| Treasury | 3,000 | 30% | 750 lamports |
| Referral | 2,000 | 20% | 500 lamports |

No referrer → referral share redirects to treasury.

**Writer total:** 6,000 lamports/chunk (5,000 reimburse + 1,000 margin).

### Cost Examples

| File Size | Chunks | Escrow (SOL) | Cost @$130/SOL |
|-----------|--------|-------------|----------------|
| 500 KB | 876 | 0.01539 | $2.00 (min floor) |
| 1 MB | 1,793 | 0.01539 | $2.00 (min floor) |
| 5 MB | 8,962 | 0.06722 | $8.74 |
| 10 MB | 17,924 | 0.13443 | $17.48 |
| 15 MB | 26,886 | 0.20165 | $26.21 |

## On-Chain Programs

### Inscription Jobs

Manages the inscription marketplace: job creation, claiming, verification, and payment.

**19 Instructions:**
- `initialize` / `update_config` / `close_config` — Config PDA management
- `create_job` — Create job with escrow, referrer, assigned node
- `claim_job` — Writer claims (stake-based priority tiers)
- `submit_receipt` — Writer submits completion proof
- `attest` — Reader verifies inscription integrity
- `release_payment` — Two-step escrow split on quorum
- `cancel_job` — Creator cancels before claim
- `refund_expired` — Refund after timeout
- `requeue_expired` — Return timed-out job to open pool
- `close_completed_job` / `close_attestation` / `admin_close_*` — PDA cleanup
- `register_referrer` / `close_referrer` — Referral system
- `transfer_authority` / `accept_authority` — Two-step authority transfer

**State Accounts:**
- `Config` PDA (`["fd-config"]`) — Global fee splits, escrow floor, job expiry
- `JobAccount` PDA (`["fd-job", job_id]`) — Per-job state, escrow, timestamps, BPS snapshot
- `VerificationAttestation` PDA (`["fd-attest", job_id, reader]`) — Per-attestation proof
- `ReferrerAccount` PDA (`["fd-referrer", wallet]`) — Registered referrer identity

**Security:**
- Fee BPS snapshot locked at job creation (can't change mid-flight)
- Self-referral blocked
- Self-attestation blocked
- Exclusive claim window for assigned nodes (default 30 min, max 1 hr)
- Escrow floor enforced (rejects unpayable jobs)
- Failed attestation auto-requeues job
- Two-step authority transfer

### Node Registry

Manages node identity, roles, and stake verification.

**8 Instructions:**
- `initialize_config` / `update_config` — Registry config
- `register_node` / `update_node` / `deregister_node` — Node lifecycle
- `heartbeat` — Liveness proof
- `verify_stake` — Delegation verification for priority tiers

**State Accounts:**
- `RegistryConfig` PDA (`["fd-registry-config"]`) — Authority, preferred validator
- `NodeAccount` PDA (`["freeze-node", wallet]`) — Identity, URL, role, stake info

**Node Roles:** Reader, Writer, Both

**Stake-Based Priority Tiers:**
1. **Tier 1** — Staked to preferred validator → instant claim
2. **Tier 2** — Staked to any validator → 0-7s delay (scales by amount)
3. **Tier 3** — No verified stake → 15s delay

## SDK Packages

| Package | Purpose |
|---------|---------|
| `@freezedry/compress` | Preserve files into .hyd blobs, hydrate back. Open + encrypted modes. |
| `@freezedry/solana` | Shred blobs into chunks, build memo TXs, confirm batches, fetch from chain |
| `@freezedry/jobs` | Jobs program client — create/fetch jobs, calculate escrow, derive PDAs |
| `@freezedry/registry` | Registry program client — fetch nodes, derive PDAs |
| `@freezedry/mint` | Metaplex Core NFT minting with manifest attributes |

### Quick Start (Browser, no bundler)

```javascript
import { wrap, unwrap } from 'https://esm.sh/@freezedry/compress@0.1.0?bundle';
import { shred, buildMemoTxs, confirmBatch, fetchBlob, estimateCost }
  from 'https://esm.sh/@freezedry/solana@0.1.0?bundle';

// Preserve a file
const blob = wrap(fileBytes, { mode: 'open' });

// Estimate cost
const cost = estimateCost(blob.byteLength);
console.log(`${cost.chunks} chunks, ~${cost.sol.toFixed(6)} SOL`);

// Shred into chunks
const chunks = shred(blob);

// Build memo transactions
const txs = buildMemoTxs(chunks, { payer, blockhash, manifestHash });

// Sign + send + confirm
const signatures = []; // collect from sendRawTransaction
const result = await confirmBatch(rpcUrl, signatures);

// Later: reconstruct from chain
const recovered = await fetchBlob(rpcUrl, signatures);
const originalFile = unwrap(recovered);
```

### Encrypted Inscription

```javascript
const blob = wrap(fileBytes, { mode: 'encrypted', password: 'mypassword' });
// blob is indistinguishable from random noise on-chain

// To reconstruct:
const recovered = await fetchBlob(rpcUrl, signatures);
const originalFile = unwrap(recovered, 'mypassword');
```

## Standalone Tool

`tools/freezedry-standalone.html` — A single HTML file that inscribes any file to Solana and reconstructs from chain. Zero external dependencies. Works offline (except for RPC calls).

**Inscribe features:**
- Any file type (images, text, PDFs, code, anything)
- Burner wallet (Ed25519, BIP39 24-word seed, Phantom-compatible derivation)
- PIN-encrypted seed storage (AES-256-GCM in localStorage)
- Open + encrypted inscription modes
- Checkpoint resume (survives tab close, crash, power outage)
- Fund reclaim (transfer remaining SOL to any address)

**Hydrate features (3 lookup modes):**
1. **Signatures** — Paste JSON array of TX signatures
2. **Pointer Lookup** — Paste one pointer signature → auto-discovers all chunks
3. **NFT Lookup** — Paste Metaplex Core NFT address → reads inscriptionHash → finds pointer → hydrates

## Node Architecture

Community nodes inscribe files, verify inscriptions, and serve cached data. Each node has a cryptographic identity (ed25519 keypair) used for peer authentication and reputation tracking.

**Roles:**
- **Reader** — Index chain, serve cached artworks, verify inscriptions
- **Writer** — Claim jobs, inscribe chunks, submit receipts
- **Both** — Combined (recommended for full participation)

**Identity:** Each node runs with two keypairs:
- **Identity key** — Peer auth, reputation, display name. Never touches SOL.
- **Hot wallet** — Signs Solana TXs, pays fees, earns escrow. Writer role only.

**Inscription throughput:**
- Proven: 15.7 TPS (single worker, WebSocket confirms)
- Scales linearly with RPC budget and concurrent jobs

**Blob fetch cascade (priority order):**
1. Job-specified blob source URL
2. Local SQLite cache
3. Peer nodes
4. CDN staging
5. Chain reconstruction (last resort, always works)

**Dependencies:** Node.js 18+, fastify, better-sqlite3, @solana/web3.js (writer only)

## CDN (Edge Delivery)

Cloudflare Worker at the edge, backed by R2 object storage.

**Routes:**
- `GET /blob/{hash}` — Immutable blob (1-year cache)
- `PUT /blob/{hash}` — Stage blob (rate-limited, SHA-256 verified)
- `GET /nodes` — Active node list from on-chain registry

R2 blobs are staging — they auto-expire after 2 days. The chain is the permanent store.

## Auth Pattern

All write operations require wallet signature verification.

```
Message: "FreezeDry:{action}:{identifier}:{timestamp}:{nonce}"
```

- Ed25519 signature verification
- Timestamp freshness: 5 minutes
- Nonce replay protection (in-memory, auto-cleaned)

### Node Peer Auth (Two-Wallet System)

Nodes use a dedicated **identity keypair** for peer-to-peer authentication, separate from the **hot wallet** used for Solana transactions.

**HTTP Headers (all peer requests):**

| Header | Value |
|--------|-------|
| `X-FD-Identity` | Base58 public key of the identity keypair |
| `X-FD-Message` | `FreezeDry:peer:{action}:{timestamp}:{nonce}` |
| `X-FD-Signature` | Base64 ed25519 signature of the message |

**Verification steps:**
1. Parse message format (must start with `FreezeDry:peer:`)
2. Check timestamp is within 5 minutes of current time
3. Verify nonce hasn't been seen before (replay protection)
4. Verify ed25519 signature against the claimed identity pubkey
5. Check identity is a known/registered peer

**Actions:** `sync-push`, `sync-notify`, `sync-announce`, `blob-pull`, `gossip-peers`, `manifest-pull`

**Display names:** Deterministic `Adjective Animal` derived from SHA-256 of identity pubkey. Cosmetic only — the pubkey is the canonical identifier.

## License

MIT
