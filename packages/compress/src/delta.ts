/**
 * @freezedry/compress — Delta computation and correction
 * The secret sauce: compute lossless corrections between lossy AVIF and original
 */

/**
 * Compute raw delta between original and lossy pixel data.
 * delta[i] = (original[i] - lossy[i] + 256) & 0xFF
 */
export function computeRawDelta(original: Uint8Array, lossy: Uint8Array): Uint8Array {
  const delta = new Uint8Array(original.length);
  for (let i = 0; i < original.length; i++) {
    delta[i] = (original[i] - lossy[i] + 256) & 0xFF;
  }
  return delta;
}

/**
 * Apply raw delta to lossy pixels to reconstruct original.
 * result[i] = (lossy[i] + delta[i]) & 0xFF
 */
export function applyRawDelta(lossy: Uint8Array, delta: Uint8Array): Uint8Array {
  const result = new Uint8Array(lossy.length);
  for (let i = 0; i < lossy.length; i++) {
    result[i] = (lossy[i] + delta[i]) & 0xFF;
  }
  return result;
}

/**
 * Near-lossless quantization: clamp small delta values to zero.
 * Values within ±threshold of zero become 0, dramatically improving gzip compression.
 * threshold=0 → lossless (no clamping)
 * threshold=1 → ±1 per channel (invisible to human eye)
 */
export function quantizeDelta(delta: Uint8Array, threshold: number): Uint8Array {
  if (threshold === 0) return delta;
  const out = new Uint8Array(delta.length);
  for (let i = 0; i < delta.length; i++) {
    const v = delta[i];
    if (v !== 0 && (v <= threshold || v >= (256 - threshold))) {
      out[i] = 0;
    } else {
      out[i] = v;
    }
  }
  return out;
}

/**
 * Compress delta using gzip on RGB-only data (strips alpha channel).
 * Stripping alpha saves 25% before compression.
 * Uses browser-native CompressionStream.
 */
export async function compressDelta(rawDelta: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const pixelCount = width * height;
  const rgb = new Uint8Array(pixelCount * 3);
  for (let i = 0, j = 0; i < rawDelta.length; i += 4, j += 3) {
    rgb[j] = rawDelta[i];         // R
    rgb[j + 1] = rawDelta[i + 1]; // G
    rgb[j + 2] = rawDelta[i + 2]; // B
  }

  // Use CompressionStream if available (browsers + Node.js 18+)
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(rgb);
    writer.close();
    const chunks: Uint8Array[] = [];
    const reader = cs.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  // Node.js fallback: zlib
  const { gzipSync } = await import('zlib');
  return new Uint8Array(gzipSync(Buffer.from(rgb)));
}

/**
 * Decompress delta — auto-detects gzip vs legacy WebP format.
 * Returns RGBA delta data (alpha channel restored as 0).
 */
export async function decompressDelta(
  compressedDelta: Uint8Array,
  width: number,
  height: number,
  webpDecoder?: (buffer: ArrayBuffer) => Promise<{ data: Uint8ClampedArray | Uint8Array }>,
): Promise<Uint8Array> {
  // Legacy WebP format detection (RIFF header)
  if (compressedDelta[0] === 0x52 && compressedDelta[1] === 0x49) {
    if (!webpDecoder) {
      throw new Error('Legacy WebP delta found but no WebP decoder provided');
    }
    const deltaImageData = await webpDecoder(compressedDelta.buffer as ArrayBuffer);
    const pixels = new Uint8Array(deltaImageData.data.buffer as ArrayBuffer);
    for (let i = 3; i < pixels.length; i += 4) {
      pixels[i] = 0;
    }
    return pixels;
  }

  // Gzip format — decompress then restore RGBA from RGB
  let rgb: Uint8Array;

  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(compressedDelta as unknown as BufferSource);
    writer.close();
    const chunks: Uint8Array[] = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
    rgb = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      rgb.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    const { gunzipSync } = await import('zlib');
    const decompressed = gunzipSync(Buffer.from(compressedDelta.buffer as ArrayBuffer, compressedDelta.byteOffset, compressedDelta.byteLength));
    rgb = new Uint8Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
  }

  // Restore RGBA from RGB (alpha = 0 for delta correction)
  const pixelCount = width * height;
  const rgba = new Uint8Array(pixelCount * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i];         // R
    rgba[j + 1] = rgb[i + 1]; // G
    rgba[j + 2] = rgb[i + 2]; // B
    rgba[j + 3] = 0;          // A (delta correction, not image alpha)
  }
  return rgba;
}
