/**
 * @freezedry/solana — Inscribe: build unsigned Solana memo transactions
 *
 * v3 protocol: each chunk gets a self-identifying header FD:{hash8}:{index}:
 * Pointer memo includes lastChunkSig as anchor for chunk discovery.
 *
 * Transactions are UNSIGNED — caller signs with their wallet or keypair.
 */

import {
  Transaction,
  TransactionInstruction,
  PublicKey,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { uint8ToBase64 } from './shred.js';
import type { BuildMemoTxsOptions } from './types.js';

/** Solana Memo Program v2 */
export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/**
 * Build unsigned memo transactions from raw blob chunks.
 * v3: each chunk includes a self-identifying header FD:{hash8}:{index}:
 *
 * @param chunks - Raw byte chunks from shred()
 * @param opts - Payer, blockhash, priority fee, and hash8 for v3 headers
 * @returns Array of unsigned Transaction objects (same order as chunks)
 *
 * @example
 * ```ts
 * const chunks = shred(blob);
 * const txs = buildMemoTxs(chunks, {
 *   payer: walletPublicKey,
 *   blockhash: recentBlockhash,
 *   hash8: manifestHash.slice(0, 8),
 * });
 *
 * // Sign all at once (wallet adapter)
 * const signed = await wallet.signAllTransactions(txs);
 * ```
 */
export function buildMemoTxs(chunks: Uint8Array[], opts: BuildMemoTxsOptions): Transaction[] {
  const { payer, blockhash, priorityFee = 10_000, hash8 } = opts;
  const encoder = new TextEncoder();

  return chunks.map((chunk, index) => {
    const base64Data = uint8ToBase64(chunk);
    // v3 header: FD:{hash8}:{index}: — self-identifying chunk
    const memoStr = hash8
      ? `FD:${hash8}:${String(index).padStart(2, '0')}:${base64Data}`
      : base64Data;
    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: payer,
    })
      .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }))
      .add(new TransactionInstruction({
        keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(encoder.encode(memoStr)),
      }));

    // Lock blockhash — prevents wallet adapters from resetting it
    tx.compileMessage();
    return tx;
  });
}

/**
 * Build a v3 pointer memo transaction.
 * Format: `FREEZEDRY:3:{hash}:{chunks}:{size}:{chunkSize}:{flags}:{inscriber}:{lastChunkSig}`
 *
 * @param manifestHash - Full manifest hash (e.g. "sha256:abc123...")
 * @param chunkCount - Total number of chunk transactions
 * @param opts - Payer, blockhash, priority fee, and v3 pointer fields
 * @returns Unsigned pointer Transaction
 */
export function buildPointerMemo(
  manifestHash: string,
  chunkCount: number,
  opts: BuildMemoTxsOptions & {
    blobSize?: number;
    chunkSize?: number;
    flags?: string;
    lastChunkSig?: string;
  },
): Transaction {
  const { payer, blockhash, priorityFee = 10_000 } = opts;
  const blobSize = opts.blobSize || 0;
  const chunkSize = opts.chunkSize || 585;
  const flags = opts.flags || 'oIc';
  const inscriber = payer.toBase58().substring(0, 8);
  const lastChunkSig = opts.lastChunkSig || '';

  const pointerData = `FREEZEDRY:3:${manifestHash}:${chunkCount}:${blobSize}:${chunkSize}:${flags}:${inscriber}:${lastChunkSig}`;

  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: payer,
  })
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }))
    .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }))
    .add(new TransactionInstruction({
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(pointerData),
    }));

  tx.compileMessage();
  return tx;
}
