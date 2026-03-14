/**
 * @freezedry/compress — Core compression engine
 *
 * freezedry(): Image → .hyd blob (AVIF lossy + lossless delta correction)
 * hydrate():   .hyd blob → original image (SHA-256 verified)
 *
 * Codec-agnostic: pass in browser WASM or Node.js sharp codec.
 */

import type {
  PixelData,
  AvifCodec,
  FreezeDryOptions,
  FreezeDryResult,
  HydrateResult,
  HydHeader,
  HydManifest,
  ProgressCallback,
} from './types.js';
import { sha256, sha256Raw, decrypt } from './crypto.js';
import { computeRawDelta, applyRawDelta, quantizeDelta, compressDelta, decompressDelta } from './delta.js';
import { MAGIC, HEADER_SIZE, MODE, MODE_NAME, buildOpenBlob, buildEncryptedBlob } from './blob.js';

// Quality sweep configuration
const QUALITY_COARSE = [10, 20, 35, 50, 65, 80, 95];
const QUALITY_FINE_RANGE = 8;
const QUALITY_FINE_STEP = 2;

/** Internal: measure total blob size for a given AVIF quality + chroma */
async function measureQuality(
  imageData: PixelData,
  originalPixels: Uint8Array,
  codec: AvifCodec,
  quality: number,
  nearLossless: number,
): Promise<{ quality: number; subsample: number; avifBytes: Uint8Array; compressedDelta: Uint8Array; total: number } | null> {
  let best: { quality: number; subsample: number; avifBytes: Uint8Array; compressedDelta: Uint8Array; total: number } | null = null;

  for (const subsample of [3, 1]) { // 3=4:4:4, 1=4:2:0
    const avifData = await codec.encode(imageData, { quality, speed: 6, subsample });
    const avifBytes = new Uint8Array(avifData);
    const lossyImageData = await codec.decode(avifData);
    const lossyPixels = new Uint8Array(lossyImageData.data.buffer as ArrayBuffer);
    let rawDelta = computeRawDelta(originalPixels, lossyPixels);
    if (nearLossless > 0) rawDelta = quantizeDelta(rawDelta, nearLossless);
    const compressed = await compressDelta(rawDelta, imageData.width, imageData.height);
    const total = HEADER_SIZE + avifBytes.byteLength + compressed.byteLength;
    if (!best || total < best.total) {
      best = { quality, subsample, avifBytes, compressedDelta: compressed, total };
    }
  }

  return best;
}

/**
 * Freeze Dry: compress pixel data into a .hyd blob.
 * Auto-optimizes AVIF quality to minimize total blob size.
 *
 * @param imageData - Pixel data (from canvas, sharp, or any pixel source)
 * @param codec - AVIF codec (browserCodec or nodeCodec)
 * @param opts - Compression options
 */
export async function freezedry(
  imageData: PixelData,
  codec: AvifCodec,
  opts: FreezeDryOptions = {},
): Promise<FreezeDryResult> {
  const { mode = 'open', password, nearLossless = 0, onProgress } = opts;
  const modeNum = MODE[mode] ?? 0;
  const progress: ProgressCallback = onProgress || (() => {});

  progress('Initializing codecs...', 2);
  const originalPixels = new Uint8Array(imageData.data.buffer as ArrayBuffer);

  // Coarse pass: find best quality region
  let best: NonNullable<Awaited<ReturnType<typeof measureQuality>>> | null = null;
  for (let i = 0; i < QUALITY_COARSE.length; i++) {
    const q = QUALITY_COARSE[i];
    const pct = 5 + Math.round((i / QUALITY_COARSE.length) * 45);
    progress(`Scanning Q${q}... (${i + 1}/${QUALITY_COARSE.length})`, pct);
    const result = await measureQuality(imageData, originalPixels, codec, q, nearLossless);
    if (result && (!best || result.total < best.total)) {
      best = result;
    }
  }

  if (!best) throw new Error('Quality sweep failed — no valid result');

  // Fine-tune: ±8 around coarse winner in steps of 2
  const fineMin = Math.max(5, best.quality - QUALITY_FINE_RANGE);
  const fineMax = Math.min(98, best.quality + QUALITY_FINE_RANGE);
  const fineCandidates: number[] = [];
  for (let q = fineMin; q <= fineMax; q += QUALITY_FINE_STEP) {
    if (!QUALITY_COARSE.includes(q)) fineCandidates.push(q);
  }
  for (let i = 0; i < fineCandidates.length; i++) {
    const q = fineCandidates[i];
    const pct = 52 + Math.round((i / fineCandidates.length) * 23);
    progress(`Fine-tuning Q${q}...`, pct);
    const result = await measureQuality(imageData, originalPixels, codec, q, nearLossless);
    if (result && result.total < best.total) {
      best = result;
    }
  }

  // Hash original pixels
  progress('Hashing original...', 80);
  const hashStr = await sha256(originalPixels);
  const hashBytes = await sha256Raw(originalPixels);

  // Build .hyd blob
  progress('Building blob...', 88);
  let blob: Uint8Array;

  if (modeNum === 0) {
    blob = buildOpenBlob(modeNum, imageData.width, imageData.height,
      best.avifBytes, best.compressedDelta, hashBytes);
  } else {
    if (!password) throw new Error('Password required for coded/proprietary mode');
    progress('Encrypting...', 92);
    blob = await buildEncryptedBlob(modeNum, imageData.width, imageData.height,
      best.avifBytes, best.compressedDelta, hashBytes, password);
  }

  progress('Done!', 100);

  const stats = {
    originalSize: originalPixels.byteLength,
    avifSize: best.avifBytes.byteLength,
    deltaSize: best.compressedDelta.byteLength,
    blobSize: blob.byteLength,
    ratio: (blob.byteLength / originalPixels.byteLength * 100).toFixed(2),
    width: imageData.width,
    height: imageData.height,
    optimalQuality: best.quality,
    optimalSubsample: best.subsample === 3 ? '4:4:4' : '4:2:0',
    nearLossless,
  };

  const manifest = buildManifest(
    hashStr, imageData.width, imageData.height,
    mode, stats.blobSize, stats.avifSize, stats.deltaSize,
  );

  return { blob, hash: hashStr, manifest, stats };
}

/**
 * Hydrate: reconstruct original image from .hyd blob.
 *
 * @param blobData - The .hyd blob bytes
 * @param codec - AVIF codec (browserCodec or nodeCodec)
 * @param password - Required if the blob is encrypted
 * @param onProgress - Progress callback
 */
export async function hydrate(
  blobData: Uint8Array | ArrayBuffer,
  codec: AvifCodec,
  password?: string,
  onProgress?: ProgressCallback,
): Promise<HydrateResult> {
  const bytes = blobData instanceof ArrayBuffer ? new Uint8Array(blobData) : blobData;
  const progress: ProgressCallback = onProgress || (() => {});

  // Parse header
  progress('Parsing header...', 5);
  const header = parseHeader(bytes);

  let width: number;
  let height: number;
  let avifBytes: Uint8Array;
  let compressedDelta: Uint8Array;
  let expectedHash: Uint8Array;

  if (header.isEncrypted) {
    if (!password) throw new Error('This blob is encrypted — password required');
    progress('Decrypting...', 15);
    const encryptedPayload = bytes.slice(5);
    const decrypted = await decrypt(encryptedPayload, password);
    const payload = new Uint8Array(decrypted);
    const pView = new DataView(payload.buffer as ArrayBuffer);

    width = pView.getUint16(0, true);
    height = pView.getUint16(2, true);
    const avifLen = pView.getUint32(4, true);
    const deltaLen = pView.getUint32(8, true);
    expectedHash = payload.slice(12, 44);
    avifBytes = payload.slice(44, 44 + avifLen);
    compressedDelta = payload.slice(44 + avifLen, 44 + avifLen + deltaLen);
  } else {
    width = header.width!;
    height = header.height!;
    const avifLen = header.avifLength!;
    const deltaLen = header.deltaLength!;
    expectedHash = bytes.slice(17, 49);
    avifBytes = bytes.slice(HEADER_SIZE, HEADER_SIZE + avifLen);
    compressedDelta = bytes.slice(HEADER_SIZE + avifLen, HEADER_SIZE + avifLen + deltaLen);
  }

  // Decode AVIF
  progress('Decoding AVIF...', 40);
  const lossyImageData = await codec.decode(avifBytes.buffer as ArrayBuffer);
  const lossyPixels = new Uint8Array(lossyImageData.data.buffer as ArrayBuffer);

  // Decompress delta
  progress('Decompressing delta...', 60);
  const rawDelta = await decompressDelta(compressedDelta, width, height);

  // Apply delta correction
  progress('Applying corrections...', 75);
  const restoredPixels = applyRawDelta(lossyPixels, rawDelta);

  // Compute SHA-256 of restored pixels
  progress('Computing hash...', 90);
  const hash = await sha256(restoredPixels);

  progress('Done!', 100);

  const pixelData: PixelData = {
    data: new Uint8ClampedArray(restoredPixels.buffer as ArrayBuffer),
    width,
    height,
  };

  return { imageData: pixelData, width, height, hash };
}

/**
 * Parse .hyd blob header (non-destructive peek)
 */
export function parseHeader(data: Uint8Array | ArrayBuffer): HydHeader {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;

  if (bytes.byteLength < 5) throw new Error('File too small to be a .hyd blob');

  if (bytes[0] !== 0x48 || bytes[1] !== 0x59 || bytes[2] !== 0x44 || bytes[3] !== 0x01) {
    throw new Error('Not a valid .hyd file — missing magic bytes');
  }

  const mode = bytes[4];
  const isEncrypted = mode === 1 || mode === 2;

  if (isEncrypted) {
    return { mode, modeName: MODE_NAME[mode] || 'unknown', isEncrypted, width: null, height: null };
  }

  if (bytes.byteLength < HEADER_SIZE) throw new Error('Corrupted .hyd header');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    mode,
    modeName: MODE_NAME[mode] || 'unknown',
    isEncrypted: false,
    width: view.getUint16(5, true),
    height: view.getUint16(7, true),
    avifLength: view.getUint32(9, true),
    deltaLength: view.getUint32(13, true),
  };
}

/**
 * Build Hydrate manifest JSON
 */
export function buildManifest(
  hash: string,
  width: number,
  height: number,
  mode: string,
  blobSize: number,
  avifSize: number,
  deltaSize: number,
  viewerUrl = 'https://freezedry.art/view',
): HydManifest {
  return {
    protocol: 'hydrate',
    version: 1,
    hash,
    dimensions: { width, height },
    mode,
    sizes: { blob: blobSize, avif: avifSize, delta: deltaSize },
    viewer: viewerUrl,
  };
}
