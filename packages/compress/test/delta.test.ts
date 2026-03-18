import { expect } from 'chai';
import { computeRawDelta, applyRawDelta, quantizeDelta, compressDelta, decompressDelta } from '../src/delta.js';

describe('@freezedry/compress — delta', () => {
  describe('computeRawDelta', () => {
    it('computes modular difference', () => {
      const original = new Uint8Array([100, 200, 50, 255]);
      const lossy = new Uint8Array([95, 200, 55, 250]);
      const delta = computeRawDelta(original, lossy);
      expect(delta[0]).to.equal(5);    // 100 - 95
      expect(delta[1]).to.equal(0);    // 200 - 200
      expect(delta[2]).to.equal(251);  // (50 - 55 + 256) & 0xFF
      expect(delta[3]).to.equal(5);    // 255 - 250
    });

    it('returns all zeros for identical inputs', () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const delta = computeRawDelta(data, data);
      expect(delta).to.deep.equal(new Uint8Array([0, 0, 0, 0]));
    });

    it('handles full range wrap-around', () => {
      const original = new Uint8Array([0]);
      const lossy = new Uint8Array([255]);
      const delta = computeRawDelta(original, lossy);
      expect(delta[0]).to.equal(1); // (0 - 255 + 256) & 0xFF = 1
    });
  });

  describe('applyRawDelta', () => {
    it('reconstructs original from lossy + delta', () => {
      const original = new Uint8Array([100, 200, 50, 255]);
      const lossy = new Uint8Array([95, 200, 55, 250]);
      const delta = computeRawDelta(original, lossy);
      const restored = applyRawDelta(lossy, delta);
      expect(restored).to.deep.equal(original);
    });

    it('round-trips for random data', () => {
      const original = new Uint8Array(256);
      const lossy = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        original[i] = (i * 7 + 13) & 0xFF;
        lossy[i] = (i * 5 + 3) & 0xFF;
      }
      const delta = computeRawDelta(original, lossy);
      const restored = applyRawDelta(lossy, delta);
      expect(restored).to.deep.equal(original);
    });
  });

  describe('quantizeDelta', () => {
    it('threshold=0 returns input unchanged', () => {
      const delta = new Uint8Array([0, 1, 2, 254, 255]);
      const result = quantizeDelta(delta, 0);
      expect(result).to.deep.equal(delta);
    });

    it('threshold=1 zeroes ±1 values', () => {
      const delta = new Uint8Array([0, 1, 2, 254, 255]);
      const result = quantizeDelta(delta, 1);
      expect(result[0]).to.equal(0);   // already 0
      expect(result[1]).to.equal(0);   // 1 within threshold
      expect(result[2]).to.equal(2);   // kept
      expect(result[3]).to.equal(254); // kept (too far from 0/256)
      expect(result[4]).to.equal(0);   // 255 = -1 mod 256, within threshold
    });

    it('threshold=2 zeroes ±2 values', () => {
      const delta = new Uint8Array([0, 1, 2, 3, 253, 254, 255]);
      const result = quantizeDelta(delta, 2);
      expect(result[0]).to.equal(0);
      expect(result[1]).to.equal(0);
      expect(result[2]).to.equal(0);
      expect(result[3]).to.equal(3);   // outside threshold
      expect(result[4]).to.equal(253); // outside threshold
      expect(result[5]).to.equal(0);   // 254 >= 256-2
      expect(result[6]).to.equal(0);   // 255 >= 256-2
    });

    it('large threshold zeroes almost everything', () => {
      const delta = new Uint8Array([0, 50, 100, 128, 200, 250]);
      const result = quantizeDelta(delta, 100);
      // 0=stays, 50=zeroed, 100=zeroed, 128=kept, 200=zeroed(256-100=156), 250=zeroed
      expect(result[0]).to.equal(0);
      expect(result[1]).to.equal(0);
      expect(result[2]).to.equal(0);
      expect(result[3]).to.equal(128);
      expect(result[4]).to.equal(0);
      expect(result[5]).to.equal(0);
    });
  });

  describe('compressDelta + decompressDelta round-trip', () => {
    it('round-trips 2x2 RGBA delta through gzip', async () => {
      const width = 2, height = 2;
      // 4 pixels, RGBA = 16 bytes
      const rawDelta = new Uint8Array([
        10, 20, 30, 0,   // pixel 0
        40, 50, 60, 0,   // pixel 1
        70, 80, 90, 0,   // pixel 2
        100, 110, 120, 0 // pixel 3
      ]);

      const compressed = await compressDelta(rawDelta, width, height);
      expect(compressed.byteLength).to.be.greaterThan(0);

      const decompressed = await decompressDelta(compressed, width, height);
      // Should restore RGB channels, alpha always 0
      expect(decompressed.length).to.equal(16);
      expect(decompressed[0]).to.equal(10);
      expect(decompressed[1]).to.equal(20);
      expect(decompressed[2]).to.equal(30);
      expect(decompressed[3]).to.equal(0);
      expect(decompressed[12]).to.equal(100);
      expect(decompressed[13]).to.equal(110);
      expect(decompressed[14]).to.equal(120);
      expect(decompressed[15]).to.equal(0);
    });

    it('strips alpha before compressing (RGB only)', async () => {
      const width = 1, height = 1;
      const rawDelta = new Uint8Array([255, 128, 64, 99]); // alpha=99

      const compressed = await compressDelta(rawDelta, width, height);
      const decompressed = await decompressDelta(compressed, width, height);

      expect(decompressed[0]).to.equal(255);
      expect(decompressed[1]).to.equal(128);
      expect(decompressed[2]).to.equal(64);
      expect(decompressed[3]).to.equal(0); // alpha stripped to 0
    });
  });
});
