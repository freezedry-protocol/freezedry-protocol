/**
 * @freezedry/solana — Confirm: batch transaction confirmation
 *
 * TCP-style verify-per-batch — never fire-and-forget Solana transactions.
 * Polls getSignatureStatuses in pages of 256, retries failed/pending sigs.
 */

import type { ConfirmResult } from './types.js';
import { sleep, rpcCall } from './rpc.js';

/**
 * Confirm all signatures are finalized/confirmed on-chain.
 * Polls in pages of 256 signatures (RPC limit).
 *
 * @param rpcUrl - Solana RPC endpoint URL
 * @param signatures - Array of transaction signatures to confirm
 * @param opts.maxAttempts - Max polling rounds (default: 10)
 * @param opts.delayMs - Delay between polling rounds (default: 2000)
 * @returns Confirmed and failed signature arrays
 */
export async function confirmBatch(
  rpcUrl: string,
  signatures: string[],
  opts: { maxAttempts?: number; delayMs?: number } = {},
): Promise<ConfirmResult> {
  const { maxAttempts = 10, delayMs = 2000 } = opts;
  const PAGE = 256;
  const confirmed = new Set<number>();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    for (let i = 0; i < signatures.length; i += PAGE) {
      const page = signatures.slice(i, i + PAGE);
      try {
        const result = await rpcCall(rpcUrl, 'getSignatureStatuses', [
          page,
          { searchTransactionHistory: true },
        ]);
        const values = (result as { value: Array<{ err: unknown; confirmationStatus: string } | null> }).value || [];
        values.forEach((s: { err: unknown; confirmationStatus: string } | null, j: number) => {
          if (s && !s.err && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) {
            confirmed.add(i + j);
          }
        });
      } catch {
        // RPC error on this page — will retry next attempt
      }
    }

    if (confirmed.size === signatures.length) {
      return { confirmed: signatures, failed: [] };
    }

    if (attempt < maxAttempts - 1) {
      await sleep(delayMs);
    }
  }

  const confirmedSigs: string[] = [];
  const failedSigs: string[] = [];
  for (let i = 0; i < signatures.length; i++) {
    if (confirmed.has(i)) {
      confirmedSigs.push(signatures[i]);
    } else {
      failedSigs.push(signatures[i]);
    }
  }

  return { confirmed: confirmedSigs, failed: failedSigs };
}
