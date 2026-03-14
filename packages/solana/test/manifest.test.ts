import { expect } from 'chai';
import { buildManifest } from '../src/manifest.js';
import { MEMO_CHUNK_SIZE } from '../src/shred.js';

describe('@freezedry/solana — manifest', () => {
  describe('buildManifest', () => {
    it('builds correct manifest structure', () => {
      const sigs = ['sig1', 'sig2', 'sig3'];
      const manifest = buildManifest('sha256:abc', { w: 640, h: 480 }, 'open', 1800, sigs);

      expect(manifest.protocol).to.equal('hydrate');
      expect(manifest.version).to.equal(1);
      expect(manifest.storage).to.equal('memo');
      expect(manifest.hash).to.equal('sha256:abc');
      expect(manifest.dimensions).to.deep.equal({ width: 640, height: 480 });
      expect(manifest.mode).to.equal('open');
      expect(manifest.blobSize).to.equal(1800);
      expect(manifest.chunkCount).to.equal(3);
      expect(manifest.chunkSize).to.equal(MEMO_CHUNK_SIZE);
      expect(manifest.signatures).to.deep.equal(sigs);
      expect(manifest.viewer).to.equal('https://freezedry.art/view');
    });

    it('chunkCount matches signatures length', () => {
      const sigs = Array.from({ length: 85 }, (_, i) => `sig${i}`);
      const manifest = buildManifest('sha256:xyz', { w: 100, h: 100 }, 'coded', 50000, sigs);
      expect(manifest.chunkCount).to.equal(85);
    });

    it('handles empty signatures', () => {
      const manifest = buildManifest('sha256:empty', { w: 1, h: 1 }, 'open', 0, []);
      expect(manifest.chunkCount).to.equal(0);
      expect(manifest.signatures).to.deep.equal([]);
    });
  });
});
