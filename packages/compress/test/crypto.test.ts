import { expect } from 'chai';
import { sha256, sha256Raw, encrypt, decrypt } from '../src/crypto.js';

describe('@freezedry/compress — crypto', () => {
  describe('sha256', () => {
    it('returns sha256: prefixed hex string', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const hash = await sha256(data);
      expect(hash).to.match(/^sha256:[a-f0-9]{64}$/);
    });

    it('produces consistent hashes', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const h1 = await sha256(data);
      const h2 = await sha256(data);
      expect(h1).to.equal(h2);
    });

    it('produces different hashes for different data', async () => {
      const h1 = await sha256(new Uint8Array([1]));
      const h2 = await sha256(new Uint8Array([2]));
      expect(h1).to.not.equal(h2);
    });

    it('handles empty input', async () => {
      const hash = await sha256(new Uint8Array(0));
      expect(hash).to.match(/^sha256:[a-f0-9]{64}$/);
      // Known SHA-256 of empty = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      expect(hash).to.equal('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
  });

  describe('sha256Raw', () => {
    it('returns 32-byte Uint8Array', async () => {
      const raw = await sha256Raw(new Uint8Array([1, 2, 3]));
      expect(raw).to.be.instanceOf(Uint8Array);
      expect(raw.byteLength).to.equal(32);
    });

    it('matches hex version', async () => {
      const data = new Uint8Array([42, 43, 44]);
      const raw = await sha256Raw(data);
      const hex = await sha256(data);
      const expectedHex = 'sha256:' + Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join('');
      expect(hex).to.equal(expectedHex);
    });
  });

  describe('encrypt + decrypt', () => {
    it('round-trips plaintext', async () => {
      const plaintext = new Uint8Array([10, 20, 30, 40, 50]);
      const encrypted = await encrypt(plaintext, 'test-password');
      const decrypted = await decrypt(encrypted, 'test-password');
      expect(new Uint8Array(decrypted)).to.deep.equal(plaintext);
    });

    it('encrypted output is larger than input (salt + iv + tag)', async () => {
      const plaintext = new Uint8Array([1, 2, 3]);
      const encrypted = await encrypt(plaintext, 'pw');
      // salt(16) + iv(12) + ciphertext(3) + tag(16) = 47 minimum
      expect(new Uint8Array(encrypted).byteLength).to.be.greaterThan(plaintext.byteLength);
    });

    it('wrong password throws', async () => {
      const plaintext = new Uint8Array([1, 2, 3]);
      const encrypted = await encrypt(plaintext, 'correct');
      try {
        await decrypt(encrypted, 'wrong');
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('Decryption failed');
      }
    });

    it('too-short data throws', async () => {
      try {
        await decrypt(new Uint8Array(10), 'pw');
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('too short');
      }
    });

    it('produces different ciphertext each time (random salt/iv)', async () => {
      const plaintext = new Uint8Array([1, 2, 3]);
      const e1 = new Uint8Array(await encrypt(plaintext, 'pw'));
      const e2 = new Uint8Array(await encrypt(plaintext, 'pw'));
      // Extremely unlikely to be identical (random salt + iv)
      let same = true;
      for (let i = 0; i < e1.length; i++) {
        if (e1[i] !== e2[i]) { same = false; break; }
      }
      expect(same).to.be.false;
    });
  });
});
