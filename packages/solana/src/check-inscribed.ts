/**
 * Check if a blob hash is already inscribed on-chain.
 *
 * Implementors call this before creating a job to avoid wasting SOL on duplicates.
 * Uses the FreezeDry registry API (Blob store) and CDN as verification sources.
 *
 * @example
 * ```ts
 * import { checkAlreadyInscribed } from '@freezedry/solana';
 *
 * const result = await checkAlreadyInscribed('sha256:abc123...');
 * if (result.inscribed) {
 *   console.log(`Already on-chain: ${result.viewUrl}`);
 * }
 * ```
 */

export interface InscriptionCheck {
  /** Whether the hash has been inscribed */
  inscribed: boolean;
  /** The normalized hash (sha256:hex) */
  hash: string;
  /** Number of memo signatures (null if unknown) */
  signatureCount: number | null;
  /** Pointer transaction signature (null if unknown) */
  pointerSig: string | null;
  /** URL to view the artwork */
  viewUrl: string | null;
}

export async function checkAlreadyInscribed(
  hash: string,
  options: {
    registryUrl?: string;
    cdnUrl?: string;
    network?: 'mainnet' | 'devnet';
    timeout?: number;
  } = {},
): Promise<InscriptionCheck> {
  const {
    registryUrl = 'https://freezedry.art',
    cdnUrl = 'https://cdn.freezedry.art',
    network = 'mainnet',
    timeout = 10_000,
  } = options;

  // Normalize hash
  const normalizedHash = hash.startsWith('sha256:') ? hash : `sha256:${hash}`;
  const cleanHex = normalizedHash.replace(/^sha256:/, '');

  // Check 1: Registry blob store — has signatures = already inscribed
  try {
    const regResp = await fetch(
      `${registryUrl}/api/memo-store?action=check-hash&hash=${encodeURIComponent(normalizedHash)}&network=${network}`,
      { signal: AbortSignal.timeout(timeout) },
    );
    if (regResp.ok) {
      const data = await regResp.json();
      if (data.exists && (data.signatureCount > 0 || data.pointerSig)) {
        return {
          inscribed: true,
          hash: normalizedHash,
          signatureCount: data.signatureCount ?? null,
          pointerSig: data.pointerSig ?? null,
          viewUrl: data.viewUrl || `${registryUrl}/v/${normalizedHash}`,
        };
      }
    }
  } catch { /* registry unavailable — fall through to CDN check */ }

  // Check 2: CDN — blob accessible = data exists on network
  try {
    const cdnResp = await fetch(`${cdnUrl}/blob/${normalizedHash}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeout),
    });
    if (cdnResp.ok) {
      return {
        inscribed: true,
        hash: normalizedHash,
        signatureCount: null,
        pointerSig: null,
        viewUrl: `${registryUrl}/v/${normalizedHash}`,
      };
    }
  } catch { /* CDN unavailable */ }

  return {
    inscribed: false,
    hash: normalizedHash,
    signatureCount: null,
    pointerSig: null,
    viewUrl: null,
  };
}
