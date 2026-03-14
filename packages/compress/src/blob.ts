/**
 * @freezedry/compress — .hyd binary format serializer/parser
 *
 * Binary Layout (open mode, 49-byte header):
 * [0-3]   Magic: 0x48 0x59 0x44 0x01 ("HYD\x01")
 * [4]     Mode: 0=open, 1=coded, 2=proprietary
 * [5-6]   Width (uint16 LE)
 * [7-8]   Height (uint16 LE)
 * [9-12]  AVIF Length (uint32 LE)
 * [13-16] Delta Length (uint32 LE)
 * [17-48] SHA-256 Hash (32 bytes raw)
 * [49..]  AVIF bytes + compressed delta bytes
 *
 * Encrypted mode (coded/proprietary):
 * [0-3]   Magic
 * [4]     Mode
 * [5..]   Encrypted payload (PBKDF2 + AES-256-GCM)
 */

import { encrypt } from './crypto.js';

export const MAGIC = new Uint8Array([0x48, 0x59, 0x44, 0x01]); // "HYD\x01"
export const HEADER_SIZE = 49; // 4 + 1 + 2 + 2 + 4 + 4 + 32
export const MODE = { open: 0, coded: 1, proprietary: 2 } as const;
export const MODE_NAME: Record<number, string> = { 0: 'open', 1: 'coded', 2: 'proprietary' };

/**
 * Build open-mode .hyd blob (49-byte header + AVIF + delta)
 */
export function buildOpenBlob(
  mode: number,
  width: number,
  height: number,
  avifBytes: Uint8Array,
  compressedDelta: Uint8Array,
  hashBytes: Uint8Array,
): Uint8Array {
  const totalSize = HEADER_SIZE + avifBytes.byteLength + compressedDelta.byteLength;
  const blob = new Uint8Array(totalSize);
  const view = new DataView(blob.buffer);

  blob.set(MAGIC, 0);
  blob[4] = mode;
  view.setUint16(5, width, true);
  view.setUint16(7, height, true);
  view.setUint32(9, avifBytes.byteLength, true);
  view.setUint32(13, compressedDelta.byteLength, true);
  blob.set(hashBytes, 17);

  blob.set(avifBytes, HEADER_SIZE);
  blob.set(compressedDelta, HEADER_SIZE + avifBytes.byteLength);

  return blob;
}

/**
 * Pack payload for encryption (same layout minus magic+mode = 44-byte header)
 */
export function buildPayload(
  width: number,
  height: number,
  avifBytes: Uint8Array,
  compressedDelta: Uint8Array,
  hashBytes: Uint8Array,
): Uint8Array {
  const payloadSize = 44 + avifBytes.byteLength + compressedDelta.byteLength;
  const payload = new Uint8Array(payloadSize);
  const view = new DataView(payload.buffer);

  view.setUint16(0, width, true);
  view.setUint16(2, height, true);
  view.setUint32(4, avifBytes.byteLength, true);
  view.setUint32(8, compressedDelta.byteLength, true);
  payload.set(hashBytes, 12);
  payload.set(avifBytes, 44);
  payload.set(compressedDelta, 44 + avifBytes.byteLength);

  return payload;
}

/**
 * Build encrypted .hyd blob (5-byte header + encrypted payload)
 */
export async function buildEncryptedBlob(
  mode: number,
  width: number,
  height: number,
  avifBytes: Uint8Array,
  compressedDelta: Uint8Array,
  hashBytes: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  const payload = buildPayload(width, height, avifBytes, compressedDelta, hashBytes);
  const encryptedPayload = await encrypt(payload, password);

  const blob = new Uint8Array(5 + encryptedPayload.byteLength);
  blob.set(MAGIC, 0);
  blob[4] = mode;
  blob.set(new Uint8Array(encryptedPayload), 5);

  return blob;
}
