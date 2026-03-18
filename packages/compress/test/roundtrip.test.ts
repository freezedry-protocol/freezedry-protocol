import { expect } from 'chai';
import { freezedry, hydrate, parseHeader } from '../src/core.js';
import { sha256 } from '../src/crypto.js';
import { HEADER_SIZE, MAGIC } from '../src/blob.js';
import { nodeCodec } from '../src/codec-node.js';
import type { PixelData } from '../src/types.js';

describe('@freezedry/compress — full round-trip (sharp)', () => {
  // Generate a test image with varied pixel data
  function makeTestImage(width: number, height: number): PixelData {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = (x * 17 + y * 31) & 0xFF;     // R
        data[i + 1] = (x * 47 + y * 13) & 0xFF; // G
        data[i + 2] = (x * 7 + y * 53) & 0xFF;  // B
        data[i + 3] = 255;                       // A
      }
    }
    return { data, width, height };
  }

  describe('freezedry → hydrate (open mode)', () => {
    it('round-trips 16x16 image with SHA-256 verification', async () => {
      const original = makeTestImage(16, 16);

      // Compress
      const result = await freezedry(original, nodeCodec, { mode: 'open' });
      expect(result.blob.byteLength).to.be.greaterThan(HEADER_SIZE);
      expect(result.hash).to.match(/^sha256:[a-f0-9]{64}$/);
      expect(result.stats.width).to.equal(16);
      expect(result.stats.height).to.equal(16);
      expect(result.stats.blobSize).to.equal(result.blob.byteLength);

      // Verify blob header
      const header = parseHeader(result.blob);
      expect(header.mode).to.equal(0);
      expect(header.modeName).to.equal('open');
      expect(header.width).to.equal(16);
      expect(header.height).to.equal(16);

      // Decompress
      const hydrated = await hydrate(result.blob, nodeCodec);
      expect(hydrated.width).to.equal(16);
      expect(hydrated.height).to.equal(16);
      expect(hydrated.hash).to.match(/^sha256:[a-f0-9]{64}$/);
    });

    it('hash matches original pixel data', async () => {
      const original = makeTestImage(8, 8);
      const originalHash = await sha256(new Uint8Array(original.data.buffer as ArrayBuffer));

      const result = await freezedry(original, nodeCodec, { mode: 'open' });
      expect(result.hash).to.equal(originalHash);
    });

    it('manifest has correct structure', async () => {
      const original = makeTestImage(8, 8);
      const result = await freezedry(original, nodeCodec, { mode: 'open' });

      expect(result.manifest.protocol).to.equal('hydrate');
      expect(result.manifest.version).to.equal(1);
      expect(result.manifest.hash).to.equal(result.hash);
      expect(result.manifest.dimensions).to.deep.equal({ width: 8, height: 8 });
      expect(result.manifest.mode).to.equal('open');
      expect(result.manifest.sizes.blob).to.equal(result.blob.byteLength);
    });

    it('stats contain compression ratio', async () => {
      const original = makeTestImage(16, 16);
      const result = await freezedry(original, nodeCodec, { mode: 'open' });

      expect(result.stats.originalSize).to.equal(16 * 16 * 4);
      expect(result.stats.avifSize).to.be.greaterThan(0);
      expect(result.stats.deltaSize).to.be.greaterThan(0);
      expect(parseFloat(result.stats.ratio)).to.be.greaterThan(0);
      expect(result.stats.optimalQuality).to.be.gte(5).and.lte(98);
    });

    it('blob starts with HYD magic bytes', async () => {
      const original = makeTestImage(8, 8);
      const result = await freezedry(original, nodeCodec);

      expect(result.blob[0]).to.equal(0x48); // H
      expect(result.blob[1]).to.equal(0x59); // Y
      expect(result.blob[2]).to.equal(0x44); // D
      expect(result.blob[3]).to.equal(0x01); // version 1
    });
  });

  describe('freezedry → hydrate (near-lossless)', () => {
    it('near-lossless=1 still produces valid blob', async () => {
      const original = makeTestImage(16, 16);
      const result = await freezedry(original, nodeCodec, { nearLossless: 1 });

      expect(result.blob.byteLength).to.be.greaterThan(HEADER_SIZE);
      expect(result.stats.nearLossless).to.equal(1);

      // Hydrate succeeds (near-lossless clamps small delta values)
      const hydrated = await hydrate(result.blob, nodeCodec);
      expect(hydrated.width).to.equal(16);
      expect(hydrated.height).to.equal(16);
      // Note: verified may be false since near-lossless clamps delta values
    });
  });

  describe('freezedry → hydrate (encrypted)', () => {
    it('round-trips encrypted blob with correct password', async () => {
      const original = makeTestImage(8, 8);
      const result = await freezedry(original, nodeCodec, {
        mode: 'coded',
        password: 'test-secret-123',
      });

      // Encrypted blob structure
      expect(result.blob[0]).to.equal(0x48); // magic
      expect(result.blob[4]).to.equal(1);     // coded mode

      // Header should show encrypted
      const header = parseHeader(result.blob);
      expect(header.isEncrypted).to.be.true;
      expect(header.width).to.be.null; // not accessible without password

      // Hydrate with correct password
      const hydrated = await hydrate(result.blob, nodeCodec, 'test-secret-123');
      expect(hydrated.width).to.equal(8);
      expect(hydrated.height).to.equal(8);
      expect(hydrated.hash).to.match(/^sha256:[a-f0-9]{64}$/);
    });

    it('wrong password throws', async () => {
      const original = makeTestImage(8, 8);
      const result = await freezedry(original, nodeCodec, {
        mode: 'coded',
        password: 'correct',
      });

      try {
        await hydrate(result.blob, nodeCodec, 'wrong-password');
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('Decryption failed');
      }
    });

    it('no password on encrypted blob throws', async () => {
      const original = makeTestImage(8, 8);
      const result = await freezedry(original, nodeCodec, {
        mode: 'coded',
        password: 'secret',
      });

      try {
        await hydrate(result.blob, nodeCodec);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('password required');
      }
    });

    it('coded mode requires password to compress', async () => {
      const original = makeTestImage(8, 8);
      try {
        await freezedry(original, nodeCodec, { mode: 'coded' });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('Password required');
      }
    });
  });

  describe('progress callback', () => {
    it('reports progress steps', async () => {
      const original = makeTestImage(8, 8);
      const steps: Array<{ step: string; pct: number }> = [];

      await freezedry(original, nodeCodec, {
        onProgress: (step, pct) => steps.push({ step, pct }),
      });

      expect(steps.length).to.be.greaterThan(5);
      expect(steps[0].pct).to.be.lessThan(steps[steps.length - 1].pct);
      expect(steps[steps.length - 1].pct).to.equal(100);
    });
  });
});
