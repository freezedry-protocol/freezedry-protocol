import { expect } from 'chai';
import { checkAlreadyInscribed } from '../src/check-inscribed.js';

function mockFetch(handler: (url: string, init?: any) => Promise<any>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as any;
  return () => { globalThis.fetch = original; };
}

describe('@freezedry/solana — check-inscribed', () => {
  describe('checkAlreadyInscribed', () => {
    it('returns inscribed=true when registry reports existing hash', async () => {
      const restore = mockFetch(async (url) => {
        if (url.includes('/api/memo-store')) {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              exists: true,
              signatureCount: 85,
              pointerSig: 'ptr123',
              viewUrl: 'https://freezedry.art/v/sha256:abc',
            }),
          };
        }
        throw new Error('Unexpected URL');
      });

      try {
        const result = await checkAlreadyInscribed('sha256:abc', { timeout: 1000 });
        expect(result.inscribed).to.be.true;
        expect(result.hash).to.equal('sha256:abc');
        expect(result.signatureCount).to.equal(85);
        expect(result.pointerSig).to.equal('ptr123');
        expect(result.viewUrl).to.include('/v/sha256:abc');
      } finally {
        restore();
      }
    });

    it('falls back to CDN check when registry fails', async () => {
      const restore = mockFetch(async (url, init) => {
        if (url.includes('/api/memo-store')) {
          throw new Error('Registry unavailable');
        }
        if (url.includes('cdn.freezedry.art/blob/') && init?.method === 'HEAD') {
          return { status: 200, ok: true };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      try {
        const result = await checkAlreadyInscribed('sha256:abc', { timeout: 1000 });
        expect(result.inscribed).to.be.true;
        expect(result.signatureCount).to.be.null; // CDN doesn't know
        expect(result.pointerSig).to.be.null;
      } finally {
        restore();
      }
    });

    it('returns inscribed=false when both checks fail', async () => {
      const restore = mockFetch(async () => {
        throw new Error('All endpoints down');
      });

      try {
        const result = await checkAlreadyInscribed('sha256:abc', { timeout: 1000 });
        expect(result.inscribed).to.be.false;
        expect(result.hash).to.equal('sha256:abc');
        expect(result.viewUrl).to.be.null;
      } finally {
        restore();
      }
    });

    it('normalizes hash without sha256: prefix', async () => {
      const restore = mockFetch(async (url) => {
        if (url.includes('/api/memo-store')) {
          // Check that the URL has normalized hash
          expect(url).to.include('sha256%3Aabc123');
          return {
            status: 200,
            ok: true,
            json: async () => ({ exists: false }),
          };
        }
        return { status: 404, ok: false };
      });

      try {
        const result = await checkAlreadyInscribed('abc123', { timeout: 1000 });
        expect(result.hash).to.equal('sha256:abc123');
      } finally {
        restore();
      }
    });

    it('returns inscribed=false when registry says not exists', async () => {
      const restore = mockFetch(async (url) => {
        if (url.includes('/api/memo-store')) {
          return {
            status: 200,
            ok: true,
            json: async () => ({ exists: false }),
          };
        }
        // CDN 404
        return { status: 404, ok: false };
      });

      try {
        const result = await checkAlreadyInscribed('sha256:notfound', { timeout: 1000 });
        expect(result.inscribed).to.be.false;
      } finally {
        restore();
      }
    });

    it('uses custom registryUrl and cdnUrl', async () => {
      const urls: string[] = [];
      const restore = mockFetch(async (url) => {
        urls.push(url);
        return { status: 404, ok: false };
      });

      try {
        await checkAlreadyInscribed('sha256:abc', {
          registryUrl: 'https://custom.example.com',
          cdnUrl: 'https://mycdn.example.com',
          timeout: 1000,
        });
        expect(urls[0]).to.include('custom.example.com');
        expect(urls[1]).to.include('mycdn.example.com');
      } finally {
        restore();
      }
    });
  });
});
