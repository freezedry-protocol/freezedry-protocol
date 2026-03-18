/**
 * @freezedry/solana — Solana memo storage for Freeze Dry Protocol
 *
 * Everything Solana: chunking, transaction building, sending, confirming,
 * and reading data back from on-chain memos.
 *
 * @example
 * ```ts
 * import {
 *   shred, buildMemoTxs, confirmBatch, fetchBlob,
 *   estimateCost, buildManifest, MEMO_CHUNK_SIZE,
 * } from '@freezedry/solana';
 *
 * // 1. Shred blob into chunks
 * const chunks = shred(hydBlob);
 *
 * // 2. Build unsigned transactions
 * const txs = buildMemoTxs(chunks, {
 *   payer: wallet.publicKey,
 *   blockhash: recentBlockhash,
 * });
 *
 * // 3. Sign + send (your wallet/keypair)
 * const signed = await wallet.signAllTransactions(txs);
 * // ... send via RPC ...
 *
 * // 4. Confirm all on-chain
 * const result = await confirmBatch(rpcUrl, signatures);
 *
 * // 5. Read back later
 * const blob = await fetchBlob(rpcUrl, manifest.signatures);
 * ```
 */

// Shred — split + reassemble
export { shred, reassemble, MEMO_CHUNK_SIZE, MEMO_PAYLOAD_SIZE, V3_HEADER_SIZE, stripV3Header, uint8ToBase64, base64ToUint8 } from './shred.js';

// Inscribe — build transactions
export { buildMemoTxs, buildPointerMemo, MEMO_PROGRAM_ID } from './inscribe.js';

// Confirm — batch confirmation
export { confirmBatch } from './confirm.js';

// Fetch — read from chain
export { fetchBlob, resolveHash } from './fetch.js';

// Manifest — build reassembly map
export { buildManifest } from './manifest.js';

// Cost estimation
export { estimateCost } from './cost.js';

// RPC helpers
export { rpcCall, sendWithRetry, fetchPriorityFee, sleep } from './rpc.js';

// Dedup — check before creating jobs
export { checkAlreadyInscribed } from './check-inscribed.js';
export type { InscriptionCheck } from './check-inscribed.js';

// Types
export type {
  ProgressCallback,
  ShredResult,
  BuildMemoTxsOptions,
  FetchBlobOptions,
  CostEstimate,
  ConfirmResult,
  MemoManifest,
  ParsedMemoTx,
} from './types.js';
