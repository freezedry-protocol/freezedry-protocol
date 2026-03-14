# SDK Test Plan

## Status: All Phases Complete (195/195 passing)

## How to Run

```bash
# All SDK tests
npm run test:sdk

# Per-package
npm run test:sdk:compress
npm run test:sdk:solana
npm run test:sdk:jobs
npm run test:sdk:registry
npm run test:sdk:mint
```

## Phase 1: Pure Logic (DONE — 93 tests)

Unit tests for all functions that don't require Solana RPC or AVIF codecs.

| Package | File | Tests | What's Covered |
|---------|------|-------|----------------|
| compress | `test/blob.test.ts` | 15 | MAGIC, HEADER_SIZE, MODE constants, buildOpenBlob layout, buildPayload layout |
| compress | `test/delta.test.ts` | 10 | computeRawDelta, applyRawDelta, quantizeDelta, compressDelta/decompressDelta round-trip |
| compress | `test/crypto.test.ts` | 9 | sha256 (hex + raw), encrypt/decrypt round-trip, wrong password, edge cases |
| compress | `test/core.test.ts` | 9 | parseHeader (open/coded/proprietary/errors), buildManifest |
| solana | `test/shred.test.ts` | 18 | shred, reassemble, round-trip, stripV3Header, base64 encode/decode |
| solana | `test/cost.test.ts` | 6 | estimateCost chunk count, SOL cost, USD cost, custom price, edge cases |
| solana | `test/manifest.test.ts` | 3 | buildManifest structure, chunkCount, empty signatures |
| jobs | `test/pda.test.ts` | 12 | All 4 PDA derivations (config, job, attestation, referrer) |
| registry | `test/pda.test.ts` | 5 | deriveNodePDA (determinism, uniqueness, custom program ID) |

## Phase 2: RPC-Dependent with Mocks (DONE — 66 tests)

Mocked `global.fetch` for solana RPC calls, mocked `Connection` objects for jobs/registry client functions.

| Package | File | Tests | What's Covered |
|---------|------|-------|----------------|
| solana | `test/inscribe.test.ts` | 17 | buildMemoTxs (TX count, instructions, v3 headers, payer/blockhash), buildPointerMemo (format, fields, lastChunkSig) |
| solana | `test/rpc.test.ts` | 12 | sleep, rpcCall (success/error/params), sendWithRetry (success/rate-limit-retry/exhaust/non-rate-error), fetchPriorityFee (percentile/clamp/default/error) |
| solana | `test/confirm.test.ts` | 7 | confirmBatch (all confirmed, partial, errors, retries, empty, RPC failures) |
| solana | `test/check-inscribed.test.ts` | 6 | checkAlreadyInscribed (registry hit, CDN fallback, both fail, hash normalization, custom URLs) |
| jobs | `test/client.test.ts` | 14 | fetchConfig (parse/null), fetchJob (parse/status-map/null), fetchAllJobs (filter), fetchOpenJobs, fetchJobAttestations, calculateEscrow (chunk count/throw), buildCreateJobTx (accounts/escrow-min/throw) |
| registry | `test/client.test.ts` | 8 | fetchAllNodes (parse/roles/empty/multiple), fetchActiveNodes (heartbeat filter/custom age), fetchNode (found/null) |

### Mock Approach
- **solana package**: `global.fetch` replaced with custom handler per test, restored in `finally` block
- **jobs/registry packages**: Mock `Connection` objects with `getAccountInfo`/`getProgramAccounts`/`getLatestBlockhash` — returns synthetic Buffer data matching Anchor account layouts (correct discriminators + Borsh field packing)

## Phase 3: Codec-Dependent (DONE — 17 tests)

Tests requiring AVIF encode/decode via sharp (Node.js codec).

| Package | File | Tests | What's Covered |
|---------|------|-------|----------------|
| compress | `test/codec-node.test.ts` | 6 | sharp encode (non-empty, quality, subsample), decode (dimensions, RGBA, lossy diffs) |
| compress | `test/roundtrip.test.ts` | 11 | Full freezedry→hydrate (open mode, near-lossless, encrypted, wrong password, no password, coded-requires-password, progress callback) |

### Known: AVIF Codec Non-Determinism
Sharp's AVIF decoder may produce slightly different pixels on re-decode of the same AVIF. This means `hydrated.verified` can be `false` even for a correct round-trip. The protocol handles this — verification is informational, not a gate.

## Phase 4: Mint Package (DONE — 19 tests)

Unit tests for preview extraction and voucher logic. Metaplex UMI-dependent functions (mintNFT, updateNFT, redeemVoucher) require devnet integration tests (future).

| Package | File | Tests | What's Covered |
|---------|------|-------|----------------|
| mint | `test/preview.test.ts` | 7 | extractPreview (open mode, encrypted, too small, corrupted length, zero-length, AVIF-only) |
| mint | `test/voucher.test.ts` | 12 | buildRedemptionMessage (content, timestamp), findActiveVouchers (active/redeemed/non-Core/authority filter/sorting/empty) |

### Not Yet Tested (need devnet/UMI mocks)
- `mintNFT`, `updateNFT` — Metaplex UMI + Arweave upload
- `redeemVoucher`, `redeemVoucherServer`, `mintVoucher` — on-chain TX building
- `verifyRedemptionRequest` — ed25519 signature verification

## Infrastructure

- **Runner**: Mocha 11.7.5 + Chai 6.2.2
- **TypeScript**: ts-node/esm loader, `tsconfig.test.json`
- **Config**: `.mocharc.yml` in repo root
- **Env var**: `TS_NODE_PROJECT=tsconfig.test.json` (set in npm scripts)
- **CI**: Not yet configured (add GitHub Actions when ready)
