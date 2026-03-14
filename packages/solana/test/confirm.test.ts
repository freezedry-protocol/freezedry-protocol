import { expect } from 'chai';
import { confirmBatch } from '../src/confirm.js';

// Mock global.fetch for RPC
function mockFetch(handler: (url: string, init: any) => Promise<any>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as any;
  return () => { globalThis.fetch = original; };
}

describe('@freezedry/solana — confirm', () => {
  describe('confirmBatch', () => {
    it('returns all confirmed when all sigs are finalized', async () => {
      const sigs = ['sig1', 'sig2', 'sig3'];
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            value: sigs.map(() => ({ err: null, confirmationStatus: 'finalized' })),
          },
        }),
      }));

      try {
        const result = await confirmBatch('http://test', sigs, { maxAttempts: 1, delayMs: 10 });
        expect(result.confirmed).to.deep.equal(sigs);
        expect(result.failed).to.deep.equal([]);
      } finally {
        restore();
      }
    });

    it('returns all confirmed for "confirmed" status', async () => {
      const sigs = ['sig1'];
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            value: [{ err: null, confirmationStatus: 'confirmed' }],
          },
        }),
      }));

      try {
        const result = await confirmBatch('http://test', sigs, { maxAttempts: 1, delayMs: 10 });
        expect(result.confirmed).to.deep.equal(['sig1']);
      } finally {
        restore();
      }
    });

    it('reports failed sigs that never confirm', async () => {
      const sigs = ['sig1', 'sig2'];
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            value: [
              { err: null, confirmationStatus: 'finalized' },
              null, // not found
            ],
          },
        }),
      }));

      try {
        const result = await confirmBatch('http://test', sigs, { maxAttempts: 2, delayMs: 10 });
        expect(result.confirmed).to.deep.equal(['sig1']);
        expect(result.failed).to.deep.equal(['sig2']);
      } finally {
        restore();
      }
    });

    it('reports sigs with errors as failed', async () => {
      const sigs = ['sig1'];
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            value: [{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'finalized' }],
          },
        }),
      }));

      try {
        const result = await confirmBatch('http://test', sigs, { maxAttempts: 1, delayMs: 10 });
        expect(result.confirmed).to.deep.equal([]);
        expect(result.failed).to.deep.equal(['sig1']);
      } finally {
        restore();
      }
    });

    it('retries pending sigs across attempts', async () => {
      let attempt = 0;
      const restore = mockFetch(async () => {
        attempt++;
        return {
          status: 200,
          ok: true,
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: {
              value: [
                { err: null, confirmationStatus: 'finalized' },
                attempt >= 2 ? { err: null, confirmationStatus: 'confirmed' } : null,
              ],
            },
          }),
        };
      });

      try {
        const result = await confirmBatch('http://test', ['sig1', 'sig2'], { maxAttempts: 3, delayMs: 10 });
        expect(result.confirmed).to.deep.equal(['sig1', 'sig2']);
        expect(result.failed).to.deep.equal([]);
        expect(attempt).to.equal(2);
      } finally {
        restore();
      }
    });

    it('handles empty signatures array', async () => {
      const restore = mockFetch(async () => {
        throw new Error('Should not be called');
      });

      try {
        const result = await confirmBatch('http://test', [], { maxAttempts: 1, delayMs: 10 });
        expect(result.confirmed).to.deep.equal([]);
        expect(result.failed).to.deep.equal([]);
      } finally {
        restore();
      }
    });

    it('survives RPC errors and retries', async () => {
      let attempt = 0;
      const restore = mockFetch(async () => {
        attempt++;
        if (attempt === 1) throw new Error('Network error');
        return {
          status: 200,
          ok: true,
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: {
              value: [{ err: null, confirmationStatus: 'finalized' }],
            },
          }),
        };
      });

      try {
        const result = await confirmBatch('http://test', ['sig1'], { maxAttempts: 3, delayMs: 10 });
        expect(result.confirmed).to.deep.equal(['sig1']);
      } finally {
        restore();
      }
    });
  });
});
