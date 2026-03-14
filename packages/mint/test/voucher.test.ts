import { expect } from 'chai';
import { buildRedemptionMessage, findActiveVouchers } from '../src/voucher.js';

function mockFetch(handler: (url: string, init?: any) => Promise<any>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as any;
  return () => { globalThis.fetch = original; };
}

describe('@freezedry/mint — voucher', () => {
  describe('buildRedemptionMessage', () => {
    it('includes voucher address', () => {
      const msg = buildRedemptionMessage('NFT_ADDRESS_123', 'sha256:abc', 50);
      expect(msg).to.include('NFT_ADDRESS_123');
    });

    it('includes inscription hash', () => {
      const msg = buildRedemptionMessage('addr', 'sha256:abc123', 50);
      expect(msg).to.include('sha256:abc123');
    });

    it('includes file size in KB', () => {
      const msg = buildRedemptionMessage('addr', 'hash', 42);
      expect(msg).to.include('42 KB');
    });

    it('starts with Freeze Dry header', () => {
      const msg = buildRedemptionMessage('addr', 'hash', 10);
      expect(msg).to.match(/^Freeze Dry/);
    });

    it('includes redemption consent text', () => {
      const msg = buildRedemptionMessage('addr', 'hash', 10);
      expect(msg).to.include('By signing this message');
      expect(msg).to.include('Freeze Dry Pass');
    });

    it('includes timestamp', () => {
      const before = Date.now();
      const msg = buildRedemptionMessage('addr', 'hash', 10);
      const after = Date.now();

      expect(msg).to.include('Timestamp:');
      // Extract timestamp from message
      const tsMatch = msg.match(/Timestamp:\s*(\d+)/);
      expect(tsMatch).to.not.be.null;
      const ts = parseInt(tsMatch![1], 10);
      expect(ts).to.be.gte(before).and.lte(after);
    });
  });

  describe('findActiveVouchers', () => {
    it('returns active vouchers from DAS response', async () => {
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          result: {
            items: [
              {
                id: 'voucher1',
                interface: 'MplCoreAsset',
                content: { metadata: { name: 'Freeze Dry Pass #1' } },
                authorities: [{ address: 'auth1', scopes: ['full'] }],
                plugins: {
                  attributes: {
                    data: {
                      attribute_list: [
                        { key: 'type', value: 'freezedry-inscription-voucher' },
                        { key: 'status', value: 'active' },
                        { key: 'max_blob_kb', value: '500' },
                      ],
                    },
                  },
                },
              },
            ],
          },
        }),
      }));

      try {
        const vouchers = await findActiveVouchers('http://test', 'owner1');
        expect(vouchers).to.have.lengthOf(1);
        expect(vouchers[0].address).to.equal('voucher1');
        expect(vouchers[0].status).to.equal('active');
        expect(vouchers[0].maxBlobKb).to.equal(500);
        expect(vouchers[0].name).to.equal('Freeze Dry Pass #1');
      } finally {
        restore();
      }
    });

    it('filters out redeemed vouchers', async () => {
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          result: {
            items: [
              {
                id: 'redeemed1',
                interface: 'MplCoreAsset',
                content: { metadata: { name: 'Pass' } },
                plugins: {
                  attributes: {
                    data: {
                      attribute_list: [
                        { key: 'type', value: 'freezedry-inscription-voucher' },
                        { key: 'status', value: 'redeemed' },
                        { key: 'max_blob_kb', value: '0' },
                      ],
                    },
                  },
                },
              },
            ],
          },
        }),
      }));

      try {
        const vouchers = await findActiveVouchers('http://test', 'owner1');
        expect(vouchers).to.have.lengthOf(0);
      } finally {
        restore();
      }
    });

    it('filters out non-Core NFTs', async () => {
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          result: {
            items: [
              {
                id: 'v1nft',
                interface: 'V1NFT', // not MplCoreAsset
                content: { metadata: { name: 'Not a core asset' } },
                plugins: {},
              },
            ],
          },
        }),
      }));

      try {
        const vouchers = await findActiveVouchers('http://test', 'owner1');
        expect(vouchers).to.have.lengthOf(0);
      } finally {
        restore();
      }
    });

    it('filters by authority when specified', async () => {
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          result: {
            items: [
              {
                id: 'v1',
                interface: 'MplCoreAsset',
                content: { metadata: { name: 'Pass' } },
                authorities: [{ address: 'wrong-auth', scopes: ['full'] }],
                plugins: {
                  attributes: {
                    data: {
                      attribute_list: [
                        { key: 'type', value: 'freezedry-inscription-voucher' },
                        { key: 'status', value: 'active' },
                        { key: 'max_blob_kb', value: '0' },
                      ],
                    },
                  },
                },
              },
            ],
          },
        }),
      }));

      try {
        const vouchers = await findActiveVouchers('http://test', 'owner1', 'expected-auth');
        expect(vouchers).to.have.lengthOf(0);
      } finally {
        restore();
      }
    });

    it('sorts by maxBlobKb descending', async () => {
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          result: {
            items: [
              makeVoucherAsset('v1', 100),
              makeVoucherAsset('v2', 500),
              makeVoucherAsset('v3', 250),
            ],
          },
        }),
      }));

      function makeVoucherAsset(id: string, maxKb: number) {
        return {
          id,
          interface: 'MplCoreAsset',
          content: { metadata: { name: 'Pass' } },
          plugins: {
            attributes: {
              data: {
                attribute_list: [
                  { key: 'type', value: 'freezedry-inscription-voucher' },
                  { key: 'status', value: 'active' },
                  { key: 'max_blob_kb', value: String(maxKb) },
                ],
              },
            },
          },
        };
      }

      try {
        const vouchers = await findActiveVouchers('http://test', 'owner1');
        expect(vouchers).to.have.lengthOf(3);
        expect(vouchers[0].maxBlobKb).to.equal(500);
        expect(vouchers[1].maxBlobKb).to.equal(250);
        expect(vouchers[2].maxBlobKb).to.equal(100);
      } finally {
        restore();
      }
    });

    it('returns empty array when no items', async () => {
      const restore = mockFetch(async () => ({
        status: 200,
        ok: true,
        json: async () => ({ result: { items: [] } }),
      }));

      try {
        const vouchers = await findActiveVouchers('http://test', 'owner1');
        expect(vouchers).to.deep.equal([]);
      } finally {
        restore();
      }
    });
  });
});
