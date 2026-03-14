/**
 * @freezedry/solana — Manifest: build the on-chain reassembly map
 */

import { MEMO_CHUNK_SIZE } from './shred.js';
import type { MemoManifest } from './types.js';

/**
 * Build a memo storage manifest — the JSON "reassembly map" that maps
 * signatures to blob data. Viewers use this to reconstruct the blob.
 *
 * @param hash - SHA-256 hash of the original pixel data ("sha256:hex...")
 * @param dims - Original image dimensions
 * @param mode - Compression mode ('open', 'coded', 'proprietary')
 * @param blobSize - Total blob size in bytes
 * @param signatures - Ordered array of memo transaction signatures
 */
export function buildManifest(
  hash: string,
  dims: { w: number; h: number },
  mode: string,
  blobSize: number,
  signatures: string[],
): MemoManifest {
  return {
    protocol: 'hydrate',
    version: 1,
    storage: 'memo',
    hash,
    dimensions: { width: dims.w, height: dims.h },
    mode,
    blobSize,
    chunkCount: signatures.length,
    chunkSize: MEMO_CHUNK_SIZE,
    signatures,
    viewer: 'https://freezedry.art/view',
  };
}
