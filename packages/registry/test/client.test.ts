import { expect } from 'chai';
import { PublicKey, Keypair } from '@solana/web3.js';
import { PROGRAM_ID, deriveNodePDA } from '../src/pda.js';
import { fetchAllNodes, fetchActiveNodes, fetchNode } from '../src/client.js';

// Account discriminator (must match client.ts)
const NODE_ACCOUNT_DISCRIMINATOR = Buffer.from([125, 166, 18, 146, 195, 127, 86, 220]);

function buildNodeData(opts: {
  wallet?: PublicKey;
  nodeId?: string;
  url?: string;
  role?: number;
  registeredAt?: number;
  lastHeartbeat?: number;
  isActive?: boolean;
  artworksIndexed?: number;
  artworksComplete?: number;
  bump?: number;
} = {}): Buffer {
  const nodeIdStr = opts.nodeId ?? 'test-node';
  const urlStr = opts.url ?? 'https://node.example.com';
  const nodeIdBytes = Buffer.from(nodeIdStr, 'utf8');
  const urlBytes = Buffer.from(urlStr, 'utf8');

  const buf = Buffer.alloc(
    8 + 32 + 4 + nodeIdBytes.length + 4 + urlBytes.length + 1 + 8 + 8 + 1 + 8 + 8 + 1 + 64
  );
  let off = 0;

  NODE_ACCOUNT_DISCRIMINATOR.copy(buf, off); off += 8;
  (opts.wallet ?? Keypair.generate().publicKey).toBuffer().copy(buf, off); off += 32;
  buf.writeUInt32LE(nodeIdBytes.length, off); off += 4;
  nodeIdBytes.copy(buf, off); off += nodeIdBytes.length;
  buf.writeUInt32LE(urlBytes.length, off); off += 4;
  urlBytes.copy(buf, off); off += urlBytes.length;
  buf[off] = opts.role ?? 2; // 0=reader, 1=writer, 2=both
  off += 1;
  buf.writeBigInt64LE(BigInt(opts.registeredAt ?? 1709500000), off); off += 8;
  buf.writeBigInt64LE(BigInt(opts.lastHeartbeat ?? Math.floor(Date.now() / 1000)), off); off += 8;
  buf[off] = (opts.isActive ?? true) ? 1 : 0; off += 1;
  buf.writeBigUInt64LE(BigInt(opts.artworksIndexed ?? 100), off); off += 8;
  buf.writeBigUInt64LE(BigInt(opts.artworksComplete ?? 95), off); off += 8;
  buf[off] = opts.bump ?? 252;

  return buf;
}

function mockConnection(handlers: {
  getAccountInfo?: (pubkey: PublicKey) => Promise<any>;
  getProgramAccounts?: (programId: PublicKey, opts?: any) => Promise<any>;
}) {
  return {
    getAccountInfo: handlers.getAccountInfo ?? (async () => null),
    getProgramAccounts: handlers.getProgramAccounts ?? (async () => []),
  } as any;
}

describe('@freezedry/registry — client', () => {
  describe('fetchAllNodes', () => {
    it('parses node account data correctly', async () => {
      const wallet = Keypair.generate().publicKey;
      const data = buildNodeData({
        wallet,
        nodeId: 'gcp-node',
        url: 'https://node-1.example.com',
        role: 2,
        isActive: true,
        artworksIndexed: 150,
        artworksComplete: 140,
      });

      const conn = mockConnection({
        getProgramAccounts: async () => [
          { pubkey: Keypair.generate().publicKey, account: { data } },
        ],
      });

      const nodes = await fetchAllNodes(conn);
      expect(nodes).to.have.lengthOf(1);
      expect(nodes[0].wallet.toBase58()).to.equal(wallet.toBase58());
      expect(nodes[0].nodeId).to.equal('gcp-node');
      expect(nodes[0].url).to.equal('https://node-1.example.com');
      expect(nodes[0].role).to.equal('both');
      expect(nodes[0].isActive).to.be.true;
      expect(nodes[0].artworksIndexed).to.equal(150);
      expect(nodes[0].artworksComplete).to.equal(140);
    });

    it('parses all role types', async () => {
      const roles = ['reader', 'writer', 'both'];
      for (let i = 0; i < roles.length; i++) {
        const data = buildNodeData({ role: i });
        const conn = mockConnection({
          getProgramAccounts: async () => [
            { pubkey: Keypair.generate().publicKey, account: { data } },
          ],
        });
        const nodes = await fetchAllNodes(conn);
        expect(nodes[0].role).to.equal(roles[i]);
      }
    });

    it('returns empty when no nodes registered', async () => {
      const conn = mockConnection({
        getProgramAccounts: async () => [],
      });
      const nodes = await fetchAllNodes(conn);
      expect(nodes).to.deep.equal([]);
    });

    it('returns multiple nodes', async () => {
      const data1 = buildNodeData({ nodeId: 'node-1' });
      const data2 = buildNodeData({ nodeId: 'node-2' });

      const conn = mockConnection({
        getProgramAccounts: async () => [
          { pubkey: Keypair.generate().publicKey, account: { data: data1 } },
          { pubkey: Keypair.generate().publicKey, account: { data: data2 } },
        ],
      });

      const nodes = await fetchAllNodes(conn);
      expect(nodes).to.have.lengthOf(2);
      expect(nodes[0].nodeId).to.equal('node-1');
      expect(nodes[1].nodeId).to.equal('node-2');
    });
  });

  describe('fetchActiveNodes', () => {
    it('filters by heartbeat freshness', async () => {
      const now = Math.floor(Date.now() / 1000);
      const activeData = buildNodeData({
        nodeId: 'active',
        lastHeartbeat: now - 3600, // 1h ago
        isActive: true,
      });
      const staleData = buildNodeData({
        nodeId: 'stale',
        lastHeartbeat: now - 200_000, // >48h ago
        isActive: true,
      });
      const inactiveData = buildNodeData({
        nodeId: 'inactive',
        lastHeartbeat: now - 100,
        isActive: false, // marked inactive
      });

      const conn = mockConnection({
        getProgramAccounts: async () => [
          { pubkey: Keypair.generate().publicKey, account: { data: activeData } },
          { pubkey: Keypair.generate().publicKey, account: { data: staleData } },
          { pubkey: Keypair.generate().publicKey, account: { data: inactiveData } },
        ],
      });

      const active = await fetchActiveNodes(conn, 86400); // 24h cutoff
      expect(active).to.have.lengthOf(1);
      expect(active[0].nodeId).to.equal('active');
    });

    it('uses custom maxAgeSeconds', async () => {
      const now = Math.floor(Date.now() / 1000);
      const data = buildNodeData({
        nodeId: 'recent',
        lastHeartbeat: now - 300, // 5 min ago
        isActive: true,
      });

      const conn = mockConnection({
        getProgramAccounts: async () => [
          { pubkey: Keypair.generate().publicKey, account: { data } },
        ],
      });

      // 10 minute cutoff — should include
      const result1 = await fetchActiveNodes(conn, 600);
      expect(result1).to.have.lengthOf(1);

      // 1 minute cutoff — should exclude
      const result2 = await fetchActiveNodes(conn, 60);
      expect(result2).to.have.lengthOf(0);
    });
  });

  describe('fetchNode', () => {
    it('returns node by owner wallet', async () => {
      const wallet = Keypair.generate().publicKey;
      const data = buildNodeData({ wallet, nodeId: 'my-node' });

      const conn = mockConnection({
        getAccountInfo: async () => ({ data }),
      });

      const node = await fetchNode(conn, wallet);
      expect(node).to.not.be.null;
      expect(node!.nodeId).to.equal('my-node');
      expect(node!.wallet.toBase58()).to.equal(wallet.toBase58());
    });

    it('returns null when node not registered', async () => {
      const conn = mockConnection({
        getAccountInfo: async () => null,
      });

      const node = await fetchNode(conn, Keypair.generate().publicKey);
      expect(node).to.be.null;
    });
  });
});
