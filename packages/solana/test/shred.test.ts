import { expect } from 'chai';
import {
  shred, reassemble,
  MEMO_CHUNK_SIZE, MEMO_PAYLOAD_SIZE, V3_HEADER_SIZE,
  stripV3Header, uint8ToBase64, base64ToUint8,
} from '../src/shred.js';

describe('@freezedry/solana — shred', () => {
  describe('constants', () => {
    it('MEMO_CHUNK_SIZE is 600', () => {
      expect(MEMO_CHUNK_SIZE).to.equal(600);
    });

    it('V3_HEADER_SIZE is 15', () => {
      expect(V3_HEADER_SIZE).to.equal(15);
    });

    it('MEMO_PAYLOAD_SIZE = MEMO_CHUNK_SIZE - V3_HEADER_SIZE', () => {
      expect(MEMO_PAYLOAD_SIZE).to.equal(MEMO_CHUNK_SIZE - V3_HEADER_SIZE);
      expect(MEMO_PAYLOAD_SIZE).to.equal(585);
    });
  });

  describe('shred', () => {
    it('shreds small blob into 1 chunk', () => {
      const blob = new Uint8Array(100);
      const chunks = shred(blob);
      expect(chunks).to.have.lengthOf(1);
      expect(chunks[0].byteLength).to.equal(100);
    });

    it('shreds exact-size blob into 1 chunk', () => {
      const blob = new Uint8Array(MEMO_PAYLOAD_SIZE);
      const chunks = shred(blob);
      expect(chunks).to.have.lengthOf(1);
    });

    it('shreds blob just over 1 chunk into 2 chunks', () => {
      const blob = new Uint8Array(MEMO_PAYLOAD_SIZE + 1);
      const chunks = shred(blob);
      expect(chunks).to.have.lengthOf(2);
      expect(chunks[0].byteLength).to.equal(MEMO_PAYLOAD_SIZE);
      expect(chunks[1].byteLength).to.equal(1);
    });

    it('calculates correct chunk count for large blob', () => {
      const size = 50000;
      const blob = new Uint8Array(size);
      const chunks = shred(blob);
      expect(chunks).to.have.lengthOf(Math.ceil(size / MEMO_PAYLOAD_SIZE));
    });

    it('uses custom chunk size', () => {
      const blob = new Uint8Array(100);
      const chunks = shred(blob, 30);
      expect(chunks).to.have.lengthOf(4); // ceil(100/30) = 4
      expect(chunks[3].byteLength).to.equal(10); // 100 - 90
    });

    it('preserves data content', () => {
      const blob = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const chunks = shred(blob, 4);
      expect(chunks[0]).to.deep.equal(new Uint8Array([1, 2, 3, 4]));
      expect(chunks[1]).to.deep.equal(new Uint8Array([5, 6, 7, 8]));
      expect(chunks[2]).to.deep.equal(new Uint8Array([9, 10]));
    });
  });

  describe('reassemble', () => {
    it('reassembles chunks back to original', () => {
      const original = new Uint8Array(2000);
      for (let i = 0; i < original.length; i++) original[i] = i & 0xFF;

      const chunks = shred(original);
      const rebuilt = reassemble(chunks);
      expect(rebuilt).to.deep.equal(original);
    });

    it('handles single chunk', () => {
      const data = new Uint8Array([1, 2, 3]);
      const rebuilt = reassemble([data]);
      expect(rebuilt).to.deep.equal(data);
    });

    it('handles empty chunks array', () => {
      const rebuilt = reassemble([]);
      expect(rebuilt.byteLength).to.equal(0);
    });
  });

  describe('shred + reassemble round-trip', () => {
    it('round-trips 50KB blob', () => {
      const original = new Uint8Array(50000);
      for (let i = 0; i < original.length; i++) original[i] = (i * 37) & 0xFF;

      const chunks = shred(original);
      const rebuilt = reassemble(chunks);
      expect(rebuilt).to.deep.equal(original);
    });
  });

  describe('stripV3Header', () => {
    it('strips FD:hash8:idx: prefix', () => {
      const memo = 'FD:abcd1234:0:SGVsbG8gV29ybGQ=';
      expect(stripV3Header(memo)).to.equal('SGVsbG8gV29ybGQ=');
    });

    it('strips multi-digit index', () => {
      const memo = 'FD:abcd1234:123:data';
      expect(stripV3Header(memo)).to.equal('data');
    });

    it('returns non-FD string unchanged', () => {
      expect(stripV3Header('regular memo data')).to.equal('regular memo data');
    });

    it('returns empty string for header-only', () => {
      expect(stripV3Header('FD:abcd1234:0:')).to.equal('');
    });
  });

  describe('base64 round-trip', () => {
    it('round-trips binary data', () => {
      const data = new Uint8Array([0, 127, 255, 128, 1]);
      const b64 = uint8ToBase64(data);
      const restored = base64ToUint8(b64);
      expect(restored).to.deep.equal(data);
    });

    it('round-trips empty data', () => {
      const data = new Uint8Array(0);
      const b64 = uint8ToBase64(data);
      const restored = base64ToUint8(b64);
      expect(restored.byteLength).to.equal(0);
    });

    it('round-trips large data', () => {
      const data = new Uint8Array(1000);
      for (let i = 0; i < 1000; i++) data[i] = i & 0xFF;
      const b64 = uint8ToBase64(data);
      const restored = base64ToUint8(b64);
      expect(restored).to.deep.equal(data);
    });
  });
});
