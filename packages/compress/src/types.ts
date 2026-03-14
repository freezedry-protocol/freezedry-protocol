/**
 * Freeze Dry Protocol — @freezedry/compress types
 */

/** Pixel data compatible with browser ImageData */
export interface PixelData {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** Compression mode: open (unencrypted), coded (password-protected), proprietary */
export type Mode = 'open' | 'coded' | 'proprietary';

/** Progress callback for long-running operations */
export type ProgressCallback = (step: string, pct: number) => void;

/** Options for the freezedry() compression function */
export interface FreezeDryOptions {
  mode?: Mode;
  password?: string;
  nearLossless?: number;
  onProgress?: ProgressCallback;
}

/** AVIF encode options passed to the codec */
export interface AvifEncodeOptions {
  quality: number;
  speed?: number;
  subsample?: number;
}

/** Result from the freezedry() compression function */
export interface FreezeDryResult {
  blob: Uint8Array;
  hash: string;
  manifest: HydManifest;
  stats: CompressionStats;
}

/** Result from the hydrate() decompression function */
export interface HydrateResult {
  imageData: PixelData;
  width: number;
  height: number;
  hash: string;
}

/** .hyd blob header parsed info */
export interface HydHeader {
  mode: number;
  modeName: string;
  isEncrypted: boolean;
  width: number | null;
  height: number | null;
  avifLength?: number;
  deltaLength?: number;
}

/** Compression manifest (JSON metadata) */
export interface HydManifest {
  protocol: 'hydrate';
  version: 1;
  hash: string;
  dimensions: { width: number; height: number };
  mode: string;
  sizes: { blob: number; avif: number; delta: number };
  viewer: string;
}

/** Compression statistics */
export interface CompressionStats {
  originalSize: number;
  avifSize: number;
  deltaSize: number;
  blobSize: number;
  ratio: string;
  width: number;
  height: number;
  optimalQuality: number;
  optimalSubsample: string;
  nearLossless: number;
}

/** Codec interface — abstraction over browser WASM and Node.js sharp */
export interface AvifCodec {
  encode(imageData: PixelData, options: AvifEncodeOptions): Promise<ArrayBuffer>;
  decode(buffer: ArrayBuffer): Promise<PixelData>;
}
