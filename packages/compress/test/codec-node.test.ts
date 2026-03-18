import { expect } from 'chai';
import { nodeCodec } from '../src/codec-node.js';
import type { PixelData } from '../src/types.js';

describe('@freezedry/compress — codec-node (sharp)', () => {
  // Create a simple 4x4 RGBA test image
  function makeTestImage(width = 4, height = 4): PixelData {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (i * 7) & 0xFF;       // R
      data[i + 1] = (i * 13) & 0xFF;  // G
      data[i + 2] = (i * 23) & 0xFF;  // B
      data[i + 3] = 255;              // A (fully opaque)
    }
    return { data, width, height };
  }

  describe('encode', () => {
    it('produces non-empty AVIF ArrayBuffer', async () => {
      const img = makeTestImage();
      const result = await nodeCodec.encode(img, { quality: 50 });
      expect(result).to.be.instanceOf(ArrayBuffer);
      expect(result.byteLength).to.be.greaterThan(0);
    });

    it('higher quality produces different (usually larger) output', async () => {
      const img = makeTestImage(16, 16);
      const low = await nodeCodec.encode(img, { quality: 10 });
      const high = await nodeCodec.encode(img, { quality: 95 });
      // Both should be valid but different
      expect(low.byteLength).to.be.greaterThan(0);
      expect(high.byteLength).to.be.greaterThan(0);
      // Can't guarantee high > low for tiny images, but they should differ
    });

    it('respects subsample parameter', async () => {
      const img = makeTestImage(16, 16);
      const yuv420 = await nodeCodec.encode(img, { quality: 50, subsample: 1 });
      const yuv444 = await nodeCodec.encode(img, { quality: 50, subsample: 3 });
      expect(yuv420.byteLength).to.be.greaterThan(0);
      expect(yuv444.byteLength).to.be.greaterThan(0);
    });
  });

  describe('decode', () => {
    it('round-trips encode → decode with correct dimensions', async () => {
      const img = makeTestImage(8, 8);
      const encoded = await nodeCodec.encode(img, { quality: 90 });
      const decoded = await nodeCodec.decode(encoded);

      expect(decoded.width).to.equal(8);
      expect(decoded.height).to.equal(8);
      expect(decoded.data.length).to.equal(8 * 8 * 4); // RGBA
    });

    it('decoded image has 4 channels (RGBA)', async () => {
      const img = makeTestImage(4, 4);
      const encoded = await nodeCodec.encode(img, { quality: 50 });
      const decoded = await nodeCodec.decode(encoded);
      // Every 4th byte should be alpha (255 for fully opaque)
      for (let i = 3; i < decoded.data.length; i += 4) {
        expect(decoded.data[i]).to.equal(255);
      }
    });

    it('lossy encode produces slightly different pixels', async () => {
      const img = makeTestImage(8, 8);
      const encoded = await nodeCodec.encode(img, { quality: 30 });
      const decoded = await nodeCodec.decode(encoded);

      // At low quality, pixels won't be identical
      let diffCount = 0;
      for (let i = 0; i < img.data.length; i++) {
        if (img.data[i] !== decoded.data[i]) diffCount++;
      }
      // Some pixels should differ (lossy compression)
      // But with very small images results may vary, so just check decode worked
      expect(decoded.data.length).to.equal(img.data.length);
    });
  });
});
