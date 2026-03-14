/**
 * @freezedry/compress — Node.js AVIF codec (sharp-based)
 *
 * 10x faster than browser WASM. Requires sharp as a peer dependency.
 * Used by @freezedry/compress/node entrypoint.
 */

import type { PixelData, AvifCodec, AvifEncodeOptions } from './types.js';

// Map subsample number to sharp's chromaSubsampling string
const SUBSAMPLE_MAP: Record<number, string> = {
  1: '4:2:0',
  3: '4:4:4',
};

/**
 * Node.js AVIF codec using sharp (10x faster than WASM)
 */
export const nodeCodec: AvifCodec = {
  async encode(imageData: PixelData, options: AvifEncodeOptions): Promise<ArrayBuffer> {
    // Dynamic import — sharp is an optional peer dependency
    // @ts-expect-error sharp types not available at build time (peer dep)
    const sharpMod = await import('sharp').catch(() => {
      throw new Error('@freezedry/compress/node requires sharp. Install it: npm install sharp');
    });
    const sharp = sharpMod.default as any;

    const { width, height, data } = imageData;
    const rawBuffer = Buffer.from(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);

    const avifBuffer = await sharp(rawBuffer, {
      raw: { width, height, channels: 4 as const },
    })
      .avif({
        quality: options.quality,
        chromaSubsampling: SUBSAMPLE_MAP[options.subsample ?? 1] ?? '4:2:0',
        effort: options.speed !== undefined ? Math.max(0, 10 - options.speed) : 4,
      })
      .toBuffer();

    return avifBuffer.buffer.slice(
      avifBuffer.byteOffset,
      avifBuffer.byteOffset + avifBuffer.byteLength,
    ) as ArrayBuffer;
  },

  async decode(buffer: ArrayBuffer): Promise<PixelData> {
    // @ts-expect-error sharp types not available at build time (peer dep)
    const sharpMod = await import('sharp').catch(() => {
      throw new Error('@freezedry/compress/node requires sharp. Install it: npm install sharp');
    });
    const sharp = sharpMod.default as any;

    const input = Buffer.from(buffer);
    const { data, info } = await sharp(input)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return {
      data: new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: info.height,
    };
  },
};
