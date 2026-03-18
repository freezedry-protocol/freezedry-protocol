/**
 * @freezedry/compress — Freeze Dry Protocol compression engine
 *
 * Lossless image compression: AVIF lossy + delta correction.
 * SHA-256 verified. Zero chain dependencies — works in browsers and Node.js.
 *
 * @example Browser usage (WASM AVIF codec)
 * ```ts
 * import { freezedry, hydrate, init, browserCodec } from '@freezedry/compress';
 *
 * init({ wasmPath: '/wasm/' });
 *
 * const result = await freezedry(imageData, browserCodec, {
 *   mode: 'open',
 *   onProgress: (step, pct) => console.log(step, pct),
 * });
 *
 * const original = await hydrate(result.blob, browserCodec);
 * console.log('Hash:', original.hash); // sha256:...
 * ```
 *
 * @example Node.js usage (sharp AVIF codec, 10x faster)
 * ```ts
 * import { freezedry, hydrate } from '@freezedry/compress';
 * import { nodeCodec } from '@freezedry/compress/node';
 *
 * const result = await freezedry(pixelData, nodeCodec);
 * ```
 */

// Core functions
export { freezedry, hydrate, parseHeader, buildManifest } from './core.js';

// Crypto utilities
export { sha256, sha256Raw, encrypt, decrypt } from './crypto.js';

// Delta operations (advanced usage)
export { computeRawDelta, applyRawDelta, quantizeDelta, compressDelta, decompressDelta } from './delta.js';

// Blob format constants
export { MAGIC, HEADER_SIZE, MODE, MODE_NAME } from './blob.js';

// Browser codec
export { browserCodec, init } from './codec-browser.js';

// Types
export type {
  PixelData,
  Mode,
  ProgressCallback,
  FreezeDryOptions,
  FreezeDryResult,
  HydrateResult,
  HydHeader,
  HydManifest,
  CompressionStats,
  AvifCodec,
  AvifEncodeOptions,
} from './types.js';
