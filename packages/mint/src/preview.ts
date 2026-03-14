/**
 * @freezedry/mint — Extract AVIF preview from .hyd blob
 *
 * The AVIF image is embedded in the blob header (open mode only).
 * This is used as the NFT preview image — a lossy approximation of the original.
 */

const HEADER_SIZE = 49;

/**
 * Extract the AVIF preview image bytes from an open-mode .hyd blob.
 * Returns null for encrypted blobs (no accessible AVIF).
 *
 * @param blob - The .hyd blob
 * @returns AVIF bytes or null if encrypted/invalid
 */
export function extractPreview(blob: Uint8Array): Uint8Array | null {
  if (blob.byteLength < HEADER_SIZE) return null;

  const mode = blob[4];
  if (mode !== 0) return null; // encrypted — no accessible AVIF

  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const avifLength = view.getUint32(9, true);

  if (HEADER_SIZE + avifLength > blob.byteLength) return null;

  return blob.slice(HEADER_SIZE, HEADER_SIZE + avifLength);
}
