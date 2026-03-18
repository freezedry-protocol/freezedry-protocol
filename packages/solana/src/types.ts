/**
 * @freezedry/solana — Types
 */

import type { PublicKey, Transaction, Connection } from '@solana/web3.js';

export type { PublicKey, Transaction, Connection } from '@solana/web3.js';

/** Progress callback for chain operations */
export type ProgressCallback = (pct: number) => void;

/** Result from shredding a blob into chunks */
export interface ShredResult {
  chunks: Uint8Array[];
  chunkCount: number;
}

/** Options for building memo transactions */
export interface BuildMemoTxsOptions {
  payer: PublicKey;
  blockhash: string;
  priorityFee?: number;
  /** First 8 hex chars of manifest hash — enables v3 self-identifying chunk headers */
  hash8?: string;
}

/** Options for fetching blob from chain */
export interface FetchBlobOptions {
  onProgress?: ProgressCallback;
  concurrency?: number;
  staggerMs?: number;
  maxRetryPasses?: number;
}

/** Cost estimation result */
export interface CostEstimate {
  chunkCount: number;
  solCost: number;
  usdCost: number;
}

/** Batch confirmation result */
export interface ConfirmResult {
  confirmed: string[];
  failed: string[];
}

/** Memo manifest — the reassembly map for on-chain data */
export interface MemoManifest {
  protocol: 'hydrate';
  version: 1;
  storage: 'memo';
  hash: string;
  dimensions: { width: number; height: number };
  mode: string;
  blobSize: number;
  chunkCount: number;
  chunkSize: number;
  signatures: string[];
  viewer: string;
}

/** Parsed transaction with memo data */
export interface ParsedMemoTx {
  signature: string;
  memoData: string | null;
}
