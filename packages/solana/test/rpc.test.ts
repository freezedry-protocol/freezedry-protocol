import { expect } from 'chai';
import { rpcCall, sendWithRetry, fetchPriorityFee, sleep } from '../src/rpc.js';

// Mock global.fetch for RPC tests
function mockFetch(handler: (url: string, init: any) => Promise<{ status: number; ok: boolean; json: () => Promise<any> }>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as any;
  return () => { globalThis.fetch = original; };
}

describe('@freezedry/solana — rpc', () => {
  describe('sleep', () => {
    it('resolves after delay', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).to.be.gte(40); // allow some timing slack
    });
  });

  describe('rpcCall', () => {
    it('makes JSON-RPC call and returns result', async () => {
      const restore = mockFetch(async (_url, init) => {
        const body = JSON.parse(init.body);
        expect(body.method).to.equal('getHealth');
        expect(body.jsonrpc).to.equal('2.0');
        return {
          status: 200,
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: 'ok' }),
        };
      });

      try {
        const result = await rpcCall('http://localhost:8899', 'getHealth', []);
        expect(result).to.equal('ok');
      } finally {
        restore();
      }
    });

    it('throws on RPC error response', async () => {
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32600, message: 'Invalid request' },
        }),
      }));

      try {
        await rpcCall('http://localhost:8899', 'badMethod', []);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('RPC badMethod failed');
        expect(e.message).to.include('Invalid request');
      } finally {
        restore();
      }
    });

    it('passes params correctly', async () => {
      const restore = mockFetch(async (_url, init) => {
        const body = JSON.parse(init.body);
        expect(body.params).to.deep.equal(['sig1', { searchTransactionHistory: true }]);
        return {
          status: 200,
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: { value: [] } }),
        };
      });

      try {
        await rpcCall('http://test', 'getSignatureStatuses', ['sig1', { searchTransactionHistory: true }]);
      } finally {
        restore();
      }
    });
  });

  describe('sendWithRetry', () => {
    it('returns signature on success', async () => {
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: 'txSig123' }),
      }));

      try {
        const sig = await sendWithRetry('http://test', 'base64EncodedTx', 3);
        expect(sig).to.equal('txSig123');
      } finally {
        restore();
      }
    });

    it('retries on rate limit and eventually succeeds', async () => {
      let attempts = 0;
      const restore = mockFetch(async () => {
        attempts++;
        if (attempts < 3) {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              jsonrpc: '2.0',
              id: 1,
              error: { code: -32429, message: 'rate limit exceeded' },
            }),
          };
        }
        return {
          status: 200,
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: 'successSig' }),
        };
      });

      try {
        const sig = await sendWithRetry('http://test', 'tx', 5);
        expect(sig).to.equal('successSig');
        expect(attempts).to.equal(3);
      } finally {
        restore();
      }
    });

    it('throws after exhausting all attempts on rate limit', async () => {
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32429, message: 'rate limit' },
        }),
      }));

      try {
        await sendWithRetry('http://test', 'tx', 2);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('rate limit');
      } finally {
        restore();
      }
    });

    it('throws immediately on non-rate-limit error', async () => {
      let attempts = 0;
      const restore = mockFetch(async () => {
        attempts++;
        return {
          status: 200,
          ok: true,
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32000, message: 'Transaction simulation failed' },
          }),
        };
      });

      try {
        await sendWithRetry('http://test', 'tx', 5);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('simulation failed');
        expect(attempts).to.equal(1); // no retry
      } finally {
        restore();
      }
    });
  });

  describe('fetchPriorityFee', () => {
    it('returns 75th percentile fee clamped to [1000, 500000]', async () => {
      const fees = Array.from({ length: 100 }, (_, i) => ({ prioritizationFee: i * 100 }));
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: fees }),
      }));

      try {
        const fee = await fetchPriorityFee('http://test');
        // 75th percentile of [0,100,...,9900] = 7500
        expect(fee).to.equal(7500);
      } finally {
        restore();
      }
    });

    it('clamps to minimum 1000', async () => {
      const fees = Array.from({ length: 10 }, () => ({ prioritizationFee: 100 }));
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: fees }),
      }));

      try {
        const fee = await fetchPriorityFee('http://test');
        expect(fee).to.equal(1000); // 100 clamped up to 1000
      } finally {
        restore();
      }
    });

    it('clamps to maximum 500000', async () => {
      const fees = Array.from({ length: 10 }, () => ({ prioritizationFee: 1_000_000 }));
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: fees }),
      }));

      try {
        const fee = await fetchPriorityFee('http://test');
        expect(fee).to.equal(500_000);
      } finally {
        restore();
      }
    });

    it('returns 10000 default on empty response', async () => {
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: [] }),
      }));

      try {
        const fee = await fetchPriorityFee('http://test');
        expect(fee).to.equal(10_000);
      } finally {
        restore();
      }
    });

    it('returns 10000 default on fetch error', async () => {
      const restore = mockFetch(async () => {
        throw new Error('Network error');
      });

      try {
        const fee = await fetchPriorityFee('http://test');
        expect(fee).to.equal(10_000);
      } finally {
        restore();
      }
    });
  });
});
