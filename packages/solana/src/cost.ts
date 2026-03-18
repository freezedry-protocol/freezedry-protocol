/**
 * @freezedry/solana — Cost estimation for memo storage
 */

import { MEMO_PAYLOAD_SIZE } from './shred.js';
import type { CostEstimate } from './types.js';

/** Solana base transaction fee in lamports */
const TX_FEE_LAMPORTS = 5000;

/**
 * Estimate the cost to store a blob on-chain via memo transactions.
 *
 * @param blobSize - Total blob size in bytes
 * @param solPrice - Current SOL price in USD (default: 180)
 * @returns Chunk count, SOL cost, and approximate USD cost
 *
 * @example
 * ```ts
 * const cost = estimateCost(50_000); // 50KB blob
 * console.log(`${cost.chunkCount} txs, ${cost.solCost} SOL (~$${cost.usdCost.toFixed(4)})`);
 * ```
 */
export function estimateCost(blobSize: number, solPrice = 180): CostEstimate {
  const chunkCount = Math.ceil(blobSize / MEMO_PAYLOAD_SIZE);
  const totalLamports = chunkCount * TX_FEE_LAMPORTS;
  const solCost = totalLamports / 1_000_000_000;
  const usdCost = solCost * solPrice;
  return { chunkCount, solCost, usdCost };
}
