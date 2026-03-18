/**
 * @freezedry/solana — Low-level RPC helpers
 *
 * Raw JSON-RPC calls with retry logic for rate limits.
 * Used internally by confirm, fetch, and inscribe modules.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Make a raw JSON-RPC call to a Solana endpoint.
 * Throws on RPC errors.
 */
export async function rpcCall(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`RPC ${method} failed: ${JSON.stringify(data.error)}`);
  return data.result;
}

/**
 * Send a raw transaction with rate-limit retry.
 * Retries on -32429 and 429 errors with exponential backoff.
 */
export async function sendWithRetry(
  rpcUrl: string,
  encodedTx: string,
  maxAttempts: number = 5,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await rpcCall(rpcUrl, 'sendTransaction', [
        encodedTx,
        { encoding: 'base64', skipPreflight: true, maxRetries: 3 },
      ]);
      return result as string;
    } catch (err) {
      const msg = (err as Error).message || '';
      const isRateLimit = msg.includes('-32429') || msg.includes('rate limit') || msg.includes('429');
      if (isRateLimit && attempt < maxAttempts - 1) {
        await sleep(1000 * (attempt + 1));
      } else {
        throw err;
      }
    }
  }
  throw new Error('sendWithRetry: exhausted all attempts');
}

/**
 * Fetch current network priority fee (microLamports per CU).
 * Returns 75th percentile of recent fees, clamped to [1000, 500000].
 */
export async function fetchPriorityFee(rpcUrl: string): Promise<number> {
  try {
    const fees = await rpcCall(rpcUrl, 'getRecentPrioritizationFees', [[]]) as Array<{ prioritizationFee: number }>;
    if (!fees || fees.length === 0) return 10_000;
    const sorted = fees.map(f => f.prioritizationFee).sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * 0.75);
    const fee = sorted[idx] || 0;
    return Math.max(1_000, Math.min(500_000, fee));
  } catch {
    return 10_000;
  }
}
