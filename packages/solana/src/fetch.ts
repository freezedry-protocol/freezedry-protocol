/**
 * @freezedry/solana — Fetch: read memos back from chain
 *
 * Concurrent individual RPC requests with configurable stagger.
 * Defaults tuned for typical RPC rate limits (adjust concurrency/stagger for your provider).
 */

import { sleep, rpcCall } from './rpc.js';
import { base64ToUint8, reassemble, stripV3Header } from './shred.js';
import type { FetchBlobOptions } from './types.js';

/** Memo Program ID for instruction matching */
const MEMO_PROGRAM_ID_STR = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

/**
 * Fetch a single transaction with rate-limit backoff.
 * Returns the parsed transaction result or null if not found.
 */
async function rpcGetTransaction(rpcUrl: string, sig: string, maxAttempts = 4): Promise<any> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [sig, {
            encoding: 'jsonParsed',
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          }],
        }),
      });

      if (resp.status === 429) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!resp.ok) throw new Error(`RPC returned ${resp.status}`);

      const data = await resp.json();
      if (data.error) {
        const errMsg = data.error.message || '';
        if (data.error.code === -32429 || errMsg.includes('rate')) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        throw new Error(`RPC error: ${JSON.stringify(data.error)}`);
      }
      return data.result;
    } catch (err) {
      if (attempt < maxAttempts - 1) await sleep(1000 * (attempt + 1));
      else throw err;
    }
  }
  return null;
}

/**
 * Extract memo data from a parsed transaction.
 * Checks both outer and inner instructions (memo may be in a CPI).
 */
function extractMemoData(tx: any): string | null {
  const allIxs = [
    ...(tx.transaction?.message?.instructions || []),
    ...(tx.meta?.innerInstructions?.flatMap((inner: any) => inner.instructions) || []),
  ];
  const memoIx = allIxs.find((ix: any) =>
    ix.programId === MEMO_PROGRAM_ID_STR || ix.program === 'spl-memo',
  );
  return memoIx?.parsed ?? null;
}

/**
 * Fetch and reconstruct a blob from on-chain memo transactions.
 *
 * @param rpcUrl - Solana RPC endpoint (any provider with archival access)
 * @param signatures - Ordered array of transaction signatures from inscription
 * @param opts - Concurrency, stagger, retry, and progress options
 * @returns The reconstructed .hyd blob
 *
 * @example
 * ```ts
 * import { fetchBlob } from '@freezedry/solana';
 *
 * const blob = await fetchBlob(
 *   process.env.SOLANA_RPC_URL,
 *   manifest.signatures,
 *   { onProgress: pct => console.log(`${pct}% loaded`) },
 * );
 * ```
 */
export async function fetchBlob(
  rpcUrl: string,
  signatures: string[],
  opts: FetchBlobOptions = {},
): Promise<Uint8Array> {
  const {
    onProgress,
    concurrency = 5,
    staggerMs = 200,
    maxRetryPasses = 3,
  } = opts;

  const results = new Array<any>(signatures.length).fill(null);
  let pending = signatures.map((_, i) => i);

  for (let pass = 0; pass < maxRetryPasses && pending.length > 0; pass++) {
    for (let g = 0; g < pending.length; g += concurrency) {
      const group = pending.slice(g, g + concurrency);
      const groupResults = await Promise.all(
        group.map(sigIdx => rpcGetTransaction(rpcUrl, signatures[sigIdx])),
      );
      groupResults.forEach((tx, j) => {
        if (tx) results[group[j]] = tx;
      });

      // Report progress
      if (onProgress) {
        const fetched = results.filter(r => r !== null).length;
        onProgress(Math.round((fetched / signatures.length) * 100));
      }

      if (g + concurrency < pending.length) await sleep(staggerMs);
    }

    // Collect still-missing
    pending = [];
    for (let i = 0; i < signatures.length; i++) {
      if (!results[i]) pending.push(i);
    }
    if (pending.length > 0 && pass < maxRetryPasses - 1) {
      await sleep(2000);
    }
  }

  // Check for missing
  const missing: number[] = [];
  for (let i = 0; i < signatures.length; i++) {
    if (!results[i]) missing.push(i);
  }
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} transactions not found after ${maxRetryPasses} passes. ` +
      `First missing: chunk ${missing[0]} (${signatures[missing[0]].slice(0, 8)}...)`,
    );
  }

  // Extract memo data and reassemble
  const parts: Uint8Array[] = [];
  for (let i = 0; i < results.length; i++) {
    const memoData = extractMemoData(results[i]);
    if (!memoData) {
      throw new Error(`No memo data in transaction ${i} (${signatures[i].slice(0, 8)}...)`);
    }
    parts.push(base64ToUint8(stripV3Header(memoData)));
  }

  return reassemble(parts);
}

/**
 * Resolve a content hash to its pointer memo on-chain.
 * Scans getSignaturesForAddress for the server wallet, looking for
 * `FREEZEDRY:{hash}:{chunkCount}` pointer memos.
 *
 * @param rpcUrl - Solana RPC endpoint
 * @param serverWallet - The server wallet address that inscribed the data
 * @param hash - The manifest hash to search for
 * @param maxScanDepth - Max signatures to scan (default: 5000)
 * @returns Pointer info or null if not found
 */
export async function resolveHash(
  rpcUrl: string,
  serverWallet: string,
  hash: string,
  maxScanDepth = 5000,
): Promise<{ chunkCount: number; pointerSig: string } | null> {
  let before: string | undefined;
  const PAGE_SIZE = 1000;
  const maxPages = Math.ceil(maxScanDepth / PAGE_SIZE);

  for (let page = 0; page < maxPages; page++) {
    const params: any[] = [serverWallet, { limit: PAGE_SIZE }];
    if (before) params[1].before = before;

    const result = await rpcCall(rpcUrl, 'getSignaturesForAddress', params) as Array<{
      signature: string;
      err: unknown;
    }>;

    if (!result || result.length === 0) break;

    // Check each sig for pointer memo
    for (let g = 0; g < result.length; g += 10) {
      const group = result.slice(g, g + 10);
      const txResults = await Promise.all(
        group.map(s => s.err ? Promise.resolve(null) : rpcGetTransaction(rpcUrl, s.signature)),
      );

      for (const tx of txResults) {
        if (!tx) continue;
        const memoData = extractMemoData(tx);
        if (!memoData || typeof memoData !== 'string') continue;

        if (memoData.startsWith('FREEZEDRY:') && memoData.includes(hash)) {
          const parts = memoData.split(':');
          const chunkCount = parseInt(parts[3], 10);
          const pointerSig = tx.transaction?.signatures?.[0];
          return { chunkCount, pointerSig };
        }
      }
      if (g + 10 < result.length) await sleep(100);
    }

    before = result[result.length - 1].signature;
  }

  return null;
}
