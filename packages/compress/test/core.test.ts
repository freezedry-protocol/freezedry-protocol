import { expect } from 'chai';
import { parseHeader, buildManifest } from '../src/core.js';
import { MAGIC, HEADER_SIZE, buildOpenBlob } from '../src/blob.js';

describe('@freezedry/compress — core', () => {
  describe('parseHeader', () => {
    function makeOpenBlob(width: number, height: number, avifLen: number, deltaLen: number): Uint8Array {
      const blob = new Uint8Array(HEADER_SIZE);
      blob.set(MAGIC, 0);
      blob[4] = 0; // open mode
      const view = new DataView(blob.buffer);
      view.setUint16(5, width, true);
      view.setUint16(7, height, true);
      view.setUint32(9, avifLen, true);
      view.setUint32(13, deltaLen, true);
      blob.set(new Uint8Array(32).fill(0xAA), 17); // hash
      return blob;
    }

    it('parses open mode header correctly', () => {
      const blob = makeOpenBlob(640, 480, 5000, 2000);
      const header = parseHeader(blob);

      expect(header.mode).to.equal(0);
      expect(header.modeName).to.equal('open');
      expect(header.isEncrypted).to.be.false;
      expect(header.width).to.equal(640);
      expect(header.height).to.equal(480);
      expect(header.avifLength).to.equal(5000);
      expect(header.deltaLength).to.equal(2000);
    });

    it('parses coded mode header', () => {
      const blob = new Uint8Array(10);
      blob.set(MAGIC, 0);
      blob[4] = 1; // coded
      const header = parseHeader(blob);

      expect(header.mode).to.equal(1);
      expect(header.modeName).to.equal('coded');
      expect(header.isEncrypted).to.be.true;
      expect(header.width).to.be.null;
      expect(header.height).to.be.null;
    });

    it('parses proprietary mode header', () => {
      const blob = new Uint8Array(10);
      blob.set(MAGIC, 0);
      blob[4] = 2;
      const header = parseHeader(blob);

      expect(header.mode).to.equal(2);
      expect(header.modeName).to.equal('proprietary');
      expect(header.isEncrypted).to.be.true;
    });

    it('throws on file too small', () => {
      expect(() => parseHeader(new Uint8Array(4))).to.throw('too small');
    });

    it('throws on invalid magic', () => {
      const blob = new Uint8Array(HEADER_SIZE);
      blob[0] = 0xFF; // wrong magic
      expect(() => parseHeader(blob)).to.throw('missing magic');
    });

    it('throws on corrupted open header (too short)', () => {
      const blob = new Uint8Array(10);
      blob.set(MAGIC, 0);
      blob[4] = 0; // open mode but only 10 bytes
      expect(() => parseHeader(blob)).to.throw('Corrupted');
    });

    it('accepts ArrayBuffer input', () => {
      const blob = makeOpenBlob(100, 200, 0, 0);
      const header = parseHeader(blob.buffer as ArrayBuffer);
      expect(header.width).to.equal(100);
    });
  });

  describe('buildManifest', () => {
    it('builds correct manifest structure', () => {
      const manifest = buildManifest('sha256:abc123', 640, 480, 'open', 10000, 8000, 2000);

      expect(manifest.protocol).to.equal('hydrate');
      expect(manifest.version).to.equal(1);
      expect(manifest.hash).to.equal('sha256:abc123');
      expect(manifest.dimensions).to.deep.equal({ width: 640, height: 480 });
      expect(manifest.mode).to.equal('open');
      expect(manifest.sizes).to.deep.equal({ blob: 10000, avif: 8000, delta: 2000 });
      expect(manifest.viewer).to.equal('https://freezedry.art/view');
    });

    it('accepts custom viewer URL', () => {
      const manifest = buildManifest('sha256:abc', 10, 10, 'open', 100, 50, 50, 'https://custom.com/view');
      expect(manifest.viewer).to.equal('https://custom.com/view');
    });
  });
});
