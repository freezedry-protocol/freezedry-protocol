import { expect } from 'chai';
import { PublicKey, Keypair } from '@solana/web3.js';
import { PROGRAM_ID, deriveConfigPDA, deriveJobPDA } from '../src/pda.js';
import {
  fetchConfig, fetchJob, fetchAllJobs, fetchOpenJobs,
  fetchJobAttestations, buildCreateJobTx, calculateEscrow,
} from '../src/client.js';
import type { ConfigInfo } from '../src/client.js';

// ── Account discriminators (must match client.ts) ──
const CONFIG_DISCRIMINATOR = Buffer.from([155, 12, 170, 224, 30, 250, 204, 130]);
const JOB_DISCRIMINATOR = Buffer.from([91, 16, 162, 5, 45, 210, 125, 65]);
const ATTEST_DISCRIMINATOR = Buffer.from([231, 126, 92, 51, 84, 178, 81, 242]);

// ── Helpers: build mock account data ──

function buildConfigData(opts: {
  authority?: PublicKey;
  treasury?: PublicKey;
  registryProgram?: PublicKey;
  inscriberFeeBps?: number;
  indexerFeeBps?: number;
  treasuryFeeBps?: number;
  referralFeeBps?: number;
  minAttestations?: number;
  jobExpirySeconds?: number;
  totalJobsCreated?: number;
  totalJobsCompleted?: number;
  bump?: number;
  minEscrowLamports?: number;
  defaultExclusiveWindow?: number;
  maxExclusiveWindow?: number;
} = {}): Buffer {
  const buf = Buffer.alloc(8 + 32 + 32 + 32 + 2 + 2 + 2 + 2 + 1 + 8 + 8 + 8 + 1 + 8 + 4 + 4);
  let off = 0;

  CONFIG_DISCRIMINATOR.copy(buf, off); off += 8;
  (opts.authority ?? Keypair.generate().publicKey).toBuffer().copy(buf, off); off += 32;
  (opts.treasury ?? Keypair.generate().publicKey).toBuffer().copy(buf, off); off += 32;
  (opts.registryProgram ?? Keypair.generate().publicKey).toBuffer().copy(buf, off); off += 32;
  buf.writeUInt16LE(opts.inscriberFeeBps ?? 3000, off); off += 2;
  buf.writeUInt16LE(opts.indexerFeeBps ?? 1000, off); off += 2;
  buf.writeUInt16LE(opts.treasuryFeeBps ?? 4000, off); off += 2;
  buf.writeUInt16LE(opts.referralFeeBps ?? 2000, off); off += 2;
  buf[off] = opts.minAttestations ?? 1; off += 1;
  buf.writeBigInt64LE(BigInt(opts.jobExpirySeconds ?? 7200), off); off += 8;
  buf.writeBigUInt64LE(BigInt(opts.totalJobsCreated ?? 5), off); off += 8;
  buf.writeBigUInt64LE(BigInt(opts.totalJobsCompleted ?? 3), off); off += 8;
  buf[off] = opts.bump ?? 255; off += 1;
  buf.writeBigUInt64LE(BigInt(opts.minEscrowLamports ?? 14_000_000), off); off += 8;
  buf.writeUInt32LE(opts.defaultExclusiveWindow ?? 1800, off); off += 4;
  buf.writeUInt32LE(opts.maxExclusiveWindow ?? 3600, off);

  return buf;
}

function buildJobData(opts: {
  jobId?: number;
  creator?: PublicKey;
  writer?: PublicKey;
  contentHash?: string;
  chunkCount?: number;
  escrowLamports?: number;
  status?: number;
  createdAt?: number;
  claimedAt?: number;
  submittedAt?: number;
  completedAt?: number;
  attestationCount?: number;
  pointerSig?: string;
  bump?: number;
  referrer?: PublicKey;
} = {}): Buffer {
  const hash = opts.contentHash ?? 'abc123';
  const hashBytes = Buffer.from(hash, 'utf8');
  const ptrSig = opts.pointerSig ?? '';
  const ptrBytes = Buffer.from(ptrSig, 'utf8');

  const buf = Buffer.alloc(
    8 + 8 + 32 + 32 + 4 + hashBytes.length + 4 + 8 + 1 + 8 + 8 + 8 + 8 + 1 + 4 + ptrBytes.length + 1 + 32
  );
  let off = 0;

  JOB_DISCRIMINATOR.copy(buf, off); off += 8;
  buf.writeBigUInt64LE(BigInt(opts.jobId ?? 0), off); off += 8;
  (opts.creator ?? Keypair.generate().publicKey).toBuffer().copy(buf, off); off += 32;
  (opts.writer ?? PublicKey.default).toBuffer().copy(buf, off); off += 32;
  buf.writeUInt32LE(hashBytes.length, off); off += 4;
  hashBytes.copy(buf, off); off += hashBytes.length;
  buf.writeUInt32LE(opts.chunkCount ?? 85, off); off += 4;
  buf.writeBigUInt64LE(BigInt(opts.escrowLamports ?? 14_000_000), off); off += 8;
  buf[off] = opts.status ?? 0; off += 1; // 0 = open
  buf.writeBigInt64LE(BigInt(opts.createdAt ?? 1709600000), off); off += 8;
  buf.writeBigInt64LE(BigInt(opts.claimedAt ?? 0), off); off += 8;
  buf.writeBigInt64LE(BigInt(opts.submittedAt ?? 0), off); off += 8;
  buf.writeBigInt64LE(BigInt(opts.completedAt ?? 0), off); off += 8;
  buf[off] = opts.attestationCount ?? 0; off += 1;
  buf.writeUInt32LE(ptrBytes.length, off); off += 4;
  ptrBytes.copy(buf, off); off += ptrBytes.length;
  buf[off] = opts.bump ?? 254; off += 1;
  (opts.referrer ?? PublicKey.default).toBuffer().copy(buf, off);

  return buf;
}

function buildAttestData(opts: {
  jobId?: number;
  reader?: PublicKey;
  isValid?: boolean;
  attestedAt?: number;
  bump?: number;
} = {}): Buffer {
  const buf = Buffer.alloc(8 + 8 + 32 + 1 + 8 + 1);
  let off = 0;

  ATTEST_DISCRIMINATOR.copy(buf, off); off += 8;
  buf.writeBigUInt64LE(BigInt(opts.jobId ?? 1), off); off += 8;
  (opts.reader ?? Keypair.generate().publicKey).toBuffer().copy(buf, off); off += 32;
  buf[off] = (opts.isValid ?? true) ? 1 : 0; off += 1;
  buf.writeBigInt64LE(BigInt(opts.attestedAt ?? 1709600000), off); off += 8;
  buf[off] = opts.bump ?? 253;

  return buf;
}

// ── Mock Connection ──

function mockConnection(handlers: {
  getAccountInfo?: (pubkey: PublicKey) => Promise<any>;
  getProgramAccounts?: (programId: PublicKey, opts?: any) => Promise<any>;
  getLatestBlockhash?: () => Promise<any>;
}) {
  return {
    getAccountInfo: handlers.getAccountInfo ?? (async () => null),
    getProgramAccounts: handlers.getProgramAccounts ?? (async () => []),
    getLatestBlockhash: handlers.getLatestBlockhash ?? (async () => ({ blockhash: '1'.repeat(32), lastValidBlockHeight: 100 })),
  } as any;
}

describe('@freezedry/jobs — client', () => {
  describe('fetchConfig', () => {
    it('parses config account data correctly', async () => {
      const authority = Keypair.generate().publicKey;
      const treasury = Keypair.generate().publicKey;
      const data = buildConfigData({
        authority,
        treasury,
        inscriberFeeBps: 3000,
        indexerFeeBps: 1000,
        treasuryFeeBps: 4000,
        referralFeeBps: 2000,
        minAttestations: 1,
        totalJobsCreated: 10,
        totalJobsCompleted: 7,
        minEscrowLamports: 14_000_000,
      });

      const conn = mockConnection({
        getAccountInfo: async () => ({ data }),
      });

      const config = await fetchConfig(conn);
      expect(config).to.not.be.null;
      expect(config!.authority.toBase58()).to.equal(authority.toBase58());
      expect(config!.treasury.toBase58()).to.equal(treasury.toBase58());
      expect(config!.inscriberFeeBps).to.equal(3000);
      expect(config!.indexerFeeBps).to.equal(1000);
      expect(config!.treasuryFeeBps).to.equal(4000);
      expect(config!.referralFeeBps).to.equal(2000);
      expect(config!.minAttestations).to.equal(1);
      expect(config!.totalJobsCreated).to.equal(10);
      expect(config!.totalJobsCompleted).to.equal(7);
      expect(config!.minEscrowLamports).to.equal(14_000_000);
    });

    it('returns null when account not found', async () => {
      const conn = mockConnection({
        getAccountInfo: async () => null,
      });
      const config = await fetchConfig(conn);
      expect(config).to.be.null;
    });
  });

  describe('fetchJob', () => {
    it('parses job account data correctly', async () => {
      const creator = Keypair.generate().publicKey;
      const data = buildJobData({
        jobId: 42,
        creator,
        contentHash: 'abc123def456',
        chunkCount: 85,
        escrowLamports: 14_000_000,
        status: 0, // open
      });

      const conn = mockConnection({
        getAccountInfo: async () => ({ data }),
      });

      const job = await fetchJob(conn, 42);
      expect(job).to.not.be.null;
      expect(job!.jobId).to.equal(42);
      expect(job!.creator.toBase58()).to.equal(creator.toBase58());
      expect(job!.contentHash).to.equal('abc123def456');
      expect(job!.chunkCount).to.equal(85);
      expect(job!.escrowLamports).to.equal(14_000_000);
      expect(job!.status).to.equal('open');
    });

    it('maps all status values correctly', async () => {
      const statuses = ['open', 'claimed', 'submitted', 'completed', 'cancelled', 'expired', 'disputed'];
      for (let i = 0; i < statuses.length; i++) {
        const data = buildJobData({ status: i });
        const conn = mockConnection({
          getAccountInfo: async () => ({ data }),
        });
        const job = await fetchJob(conn, 0);
        expect(job!.status).to.equal(statuses[i]);
      }
    });

    it('returns null when account not found', async () => {
      const conn = mockConnection({
        getAccountInfo: async () => null,
      });
      const job = await fetchJob(conn, 999);
      expect(job).to.be.null;
    });
  });

  describe('fetchAllJobs', () => {
    it('returns parsed jobs from getProgramAccounts', async () => {
      const job1Data = buildJobData({ jobId: 1, status: 0 });
      const job2Data = buildJobData({ jobId: 2, status: 3 });

      const conn = mockConnection({
        getProgramAccounts: async () => [
          { pubkey: Keypair.generate().publicKey, account: { data: job1Data } },
          { pubkey: Keypair.generate().publicKey, account: { data: job2Data } },
        ],
      });

      const jobs = await fetchAllJobs(conn);
      expect(jobs).to.have.lengthOf(2);
      expect(jobs[0].jobId).to.equal(1);
      expect(jobs[1].jobId).to.equal(2);
    });

    it('filters by status when provided', async () => {
      const job1Data = buildJobData({ jobId: 1, status: 0 }); // open
      const job2Data = buildJobData({ jobId: 2, status: 3 }); // completed

      const conn = mockConnection({
        getProgramAccounts: async () => [
          { pubkey: Keypair.generate().publicKey, account: { data: job1Data } },
          { pubkey: Keypair.generate().publicKey, account: { data: job2Data } },
        ],
      });

      const openJobs = await fetchAllJobs(conn, 'open');
      expect(openJobs).to.have.lengthOf(1);
      expect(openJobs[0].status).to.equal('open');
    });
  });

  describe('fetchOpenJobs', () => {
    it('delegates to fetchAllJobs with status=open', async () => {
      const jobData = buildJobData({ jobId: 1, status: 0 });
      const conn = mockConnection({
        getProgramAccounts: async () => [
          { pubkey: Keypair.generate().publicKey, account: { data: jobData } },
        ],
      });

      const jobs = await fetchOpenJobs(conn);
      expect(jobs).to.have.lengthOf(1);
      expect(jobs[0].status).to.equal('open');
    });
  });

  describe('fetchJobAttestations', () => {
    it('parses attestation accounts', async () => {
      const reader = Keypair.generate().publicKey;
      const attestData = buildAttestData({ jobId: 1, reader, isValid: true });

      const conn = mockConnection({
        getProgramAccounts: async () => [
          { pubkey: Keypair.generate().publicKey, account: { data: attestData } },
        ],
      });

      const attestations = await fetchJobAttestations(conn, 1);
      expect(attestations).to.have.lengthOf(1);
      expect(attestations[0].jobId).to.equal(1);
      expect(attestations[0].reader.toBase58()).to.equal(reader.toBase58());
      expect(attestations[0].isValid).to.be.true;
    });

    it('returns empty array when no attestations', async () => {
      const conn = mockConnection({
        getProgramAccounts: async () => [],
      });
      const attestations = await fetchJobAttestations(conn, 99);
      expect(attestations).to.deep.equal([]);
    });
  });

  describe('calculateEscrow', () => {
    it('calculates chunk count and returns min escrow from config', async () => {
      const configData = buildConfigData({ minEscrowLamports: 14_000_000 });
      const conn = mockConnection({
        getAccountInfo: async () => ({ data: configData }),
      });

      const result = await calculateEscrow({
        connection: conn,
        blobSizeBytes: 50_000,
      });

      // 50000 / 585 = 85.47 → 86 chunks
      expect(result.chunkCount).to.equal(86);
      expect(result.minEscrowLamports).to.equal(14_000_000);
    });

    it('throws when config not found', async () => {
      const conn = mockConnection({
        getAccountInfo: async () => null,
      });

      try {
        await calculateEscrow({ connection: conn, blobSizeBytes: 1000 });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('Config PDA not found');
      }
    });
  });

  describe('buildCreateJobTx', () => {
    it('builds unsigned transaction with correct accounts', async () => {
      const creator = Keypair.generate().publicKey;
      const treasury = Keypair.generate().publicKey;
      const configData = buildConfigData({
        treasury,
        totalJobsCreated: 5,
        minEscrowLamports: 14_000_000,
      });

      const conn = mockConnection({
        getAccountInfo: async () => ({ data: configData }),
        getLatestBlockhash: async () => ({
          blockhash: '1'.repeat(32),
          lastValidBlockHeight: 100,
        }),
      });

      const result = await buildCreateJobTx({
        connection: conn,
        creator,
        contentHash: 'sha256:abc123def',
        chunkCount: 85,
        escrowLamports: 14_000_000,
      });

      expect(result.jobId).to.equal(5); // totalJobsCreated from config
      expect(result.jobPDA).to.be.instanceOf(PublicKey);
      expect(result.transaction).to.exist;
      expect(result.transaction.feePayer!.toBase58()).to.equal(creator.toBase58());
    });

    it('throws when escrow below minimum', async () => {
      const configData = buildConfigData({ minEscrowLamports: 14_000_000 });
      const conn = mockConnection({
        getAccountInfo: async () => ({ data: configData }),
      });

      try {
        await buildCreateJobTx({
          connection: conn,
          creator: Keypair.generate().publicKey,
          contentHash: 'sha256:abc',
          chunkCount: 10,
          escrowLamports: 1_000_000, // below 14M minimum
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('below minimum');
      }
    });

    it('throws when config not initialized', async () => {
      const conn = mockConnection({
        getAccountInfo: async () => null,
      });

      try {
        await buildCreateJobTx({
          connection: conn,
          creator: Keypair.generate().publicKey,
          contentHash: 'sha256:abc',
          chunkCount: 10,
          escrowLamports: 14_000_000,
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('not initialized');
      }
    });
  });
});
