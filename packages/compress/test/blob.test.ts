import { expect } from 'chai';
import { MAGIC, HEADER_SIZE, MODE, MODE_NAME, buildOpenBlob, buildPayload } from '../src/blob.js';

describe('@freezedry/compress — blob', () => {
  describe('constants', () => {
    it('MAGIC is HYD\\x01', () => {
      expect(MAGIC).to.deep.equal(new Uint8Array([0x48, 0x59, 0x44, 0x01]));
    });

    it('HEADER_SIZE is 49 bytes', () => {
      expect(HEADER_SIZE).to.equal(49);
    });

    it('MODE enum has open=0, coded=1, proprietary=2', () => {
      expect(MODE.open).to.equal(0);
      expect(MODE.coded).to.equal(1);
      expect(MODE.proprietary).to.equal(2);
    });

    it('MODE_NAME maps back correctly', () => {
      expect(MODE_NAME[0]).to.equal('open');
      expect(MODE_NAME[1]).to.equal('coded');
      expect(MODE_NAME[2]).to.equal('proprietary');
    });
  });

  describe('buildOpenBlob', () => {
    const avif = new Uint8Array([1, 2, 3, 4, 5]);
    const delta = new Uint8Array([10, 20, 30]);
    const hash = new Uint8Array(32).fill(0xAB);

    it('produces correct total size', () => {
      const blob = buildOpenBlob(0, 100, 200, avif, delta, hash);
      expect(blob.byteLength).to.equal(HEADER_SIZE + avif.byteLength + delta.byteLength);
    });

    it('starts with MAGIC bytes', () => {
      const blob = buildOpenBlob(0, 100, 200, avif, delta, hash);
      expect(blob[0]).to.equal(0x48);
      expect(blob[1]).to.equal(0x59);
      expect(blob[2]).to.equal(0x44);
      expect(blob[3]).to.equal(0x01);
    });

    it('stores mode byte at offset 4', () => {
      const blob = buildOpenBlob(0, 100, 200, avif, delta, hash);
      expect(blob[4]).to.equal(0);

      const blobCoded = buildOpenBlob(1, 100, 200, avif, delta, hash);
      expect(blobCoded[4]).to.equal(1);
    });

    it('stores width and height as LE uint16', () => {
      const blob = buildOpenBlob(0, 300, 400, avif, delta, hash);
      const view = new DataView(blob.buffer);
      expect(view.getUint16(5, true)).to.equal(300);
      expect(view.getUint16(7, true)).to.equal(400);
    });

    it('stores AVIF and delta lengths as LE uint32', () => {
      const blob = buildOpenBlob(0, 100, 200, avif, delta, hash);
      const view = new DataView(blob.buffer);
      expect(view.getUint32(9, true)).to.equal(5);  // avif length
      expect(view.getUint32(13, true)).to.equal(3); // delta length
    });

    it('stores 32-byte hash at offset 17', () => {
      const blob = buildOpenBlob(0, 100, 200, avif, delta, hash);
      const storedHash = blob.slice(17, 49);
      expect(storedHash).to.deep.equal(hash);
    });

    it('stores AVIF then delta after header', () => {
      const blob = buildOpenBlob(0, 100, 200, avif, delta, hash);
      expect(blob.slice(HEADER_SIZE, HEADER_SIZE + 5)).to.deep.equal(avif);
      expect(blob.slice(HEADER_SIZE + 5, HEADER_SIZE + 8)).to.deep.equal(delta);
    });

    it('handles empty delta', () => {
      const emptyDelta = new Uint8Array(0);
      const blob = buildOpenBlob(0, 100, 200, avif, emptyDelta, hash);
      expect(blob.byteLength).to.equal(HEADER_SIZE + avif.byteLength);
    });
  });

  describe('buildPayload', () => {
    const avif = new Uint8Array([1, 2, 3]);
    const delta = new Uint8Array([10, 20]);
    const hash = new Uint8Array(32).fill(0xCC);

    it('produces 44 + data bytes (no magic/mode)', () => {
      const payload = buildPayload(100, 200, avif, delta, hash);
      expect(payload.byteLength).to.equal(44 + 3 + 2);
    });

    it('stores width/height at offsets 0-3', () => {
      const payload = buildPayload(640, 480, avif, delta, hash);
      const view = new DataView(payload.buffer);
      expect(view.getUint16(0, true)).to.equal(640);
      expect(view.getUint16(2, true)).to.equal(480);
    });

    it('stores hash at offset 12', () => {
      const payload = buildPayload(100, 200, avif, delta, hash);
      expect(payload.slice(12, 44)).to.deep.equal(hash);
    });
  });
});
