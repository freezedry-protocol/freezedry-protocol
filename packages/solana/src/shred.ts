/**
 * @freezedry/solana — Shred: split blob into chain-ready chunks
 *
 * v3 protocol: each chunk gets a self-identifying header FD:{hash8}:{index}:
 * 600 total bytes per memo tx, 15-byte header, 585 bytes usable payload.
 */

/** Maximum total bytes per memo transaction (including v3 header) */
export const MEMO_CHUNK_SIZE = 600;

/** v3 header overhead: FD:{hash8}:{idx}: = 15 bytes */
export const V3_HEADER_SIZE = 15;

/** Usable data payload per chunk after v3 header */
export const MEMO_PAYLOAD_SIZE = MEMO_CHUNK_SIZE - V3_HEADER_SIZE;

/**
 * Split a blob into fixed-size chunks ready for on-chain storage.
 * Each chunk is a raw Uint8Array of payload data (header applied at inscription time).
 *
 * @param blob - The .hyd blob to split
 * @param chunkSize - Payload bytes per chunk (default: 585)
 * @returns Array of chunk Uint8Arrays, ordered for sequential inscription
 */
export function shred(blob: Uint8Array, chunkSize: number = MEMO_PAYLOAD_SIZE): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < blob.length; offset += chunkSize) {
    chunks.push(blob.slice(offset, Math.min(offset + chunkSize, blob.length)));
  }
  return chunks;
}

/**
 * Reassemble chunks back into the original blob.
 * Chunks must be in order (index 0, 1, 2, ...).
 */
export function reassemble(chunks: Uint8Array[]): Uint8Array {
  const totalLen = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Strip v3 header (FD:{hash8}:{index}:) from a memo string.
 * Returns the raw base64 data portion. No-op for v2 chunks (no header).
 */
export function stripV3Header(memoStr: string): string {
  if (memoStr.startsWith('FD:')) {
    const thirdColon = memoStr.indexOf(':', memoStr.indexOf(':', 3) + 1);
    if (thirdColon !== -1) return memoStr.slice(thirdColon + 1);
  }
  return memoStr;
}

// Base64 encode/decode utilities (work in browser + Node.js)

export function uint8ToBase64(bytes: Uint8Array): string {
  // Node.js Buffer path (faster)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  // Browser path
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8(base64: string): Uint8Array {
  // Node.js Buffer path
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(base64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  // Browser path
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
