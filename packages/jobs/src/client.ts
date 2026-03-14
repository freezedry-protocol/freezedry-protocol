import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SystemProgram,
  GetProgramAccountsFilter,
} from "@solana/web3.js";
import { PROGRAM_ID, deriveJobPDA, deriveConfigPDA, deriveReferrerPDA } from "./pda.js";

// ── Types ──

export type JobStatus =
  | "open"
  | "claimed"
  | "submitted"
  | "completed"
  | "cancelled"
  | "expired"
  | "disputed";

export interface ConfigInfo {
  address: PublicKey;
  authority: PublicKey;
  treasury: PublicKey;
  registryProgram: PublicKey;
  inscriberFeeBps: number;
  indexerFeeBps: number;
  treasuryFeeBps: number;
  referralFeeBps: number;
  minAttestations: number;
  jobExpirySeconds: number;
  totalJobsCreated: number;
  totalJobsCompleted: number;
  bump: number;
  minEscrowLamports: number;
  defaultExclusiveWindow: number;
  maxExclusiveWindow: number;
}

export interface JobInfo {
  address: PublicKey;
  jobId: number;
  creator: PublicKey;
  writer: PublicKey;
  contentHash: string;
  chunkCount: number;
  escrowLamports: number;
  status: JobStatus;
  createdAt: number;
  claimedAt: number;
  submittedAt: number;
  completedAt: number;
  attestationCount: number;
  pointerSig: string;
  bump: number;
  referrer: PublicKey;
  assignedNode: PublicKey | null;
  exclusiveUntil: number;
  blobSource: string;
}

export interface AttestationInfo {
  address: PublicKey;
  jobId: number;
  reader: PublicKey;
  isValid: boolean;
  attestedAt: number;
  bump: number;
}

// ── Discriminators (from Anchor IDL, auto-generated) ──
// These will need updating after the first build generates the IDL.
// For now, they're placeholders — the real values come from the IDL.

// Discriminators from freezedry_jobs IDL (auto-generated)
const CONFIG_DISCRIMINATOR = Buffer.from([155, 12, 170, 224, 30, 250, 204, 130]);
const JOB_DISCRIMINATOR = Buffer.from([91, 16, 162, 5, 45, 210, 125, 65]);
const ATTEST_DISCRIMINATOR = Buffer.from([231, 126, 92, 51, 84, 178, 81, 242]);

// Instruction discriminator for create_job
const IX_CREATE_JOB = Buffer.from([178, 130, 217, 110, 100, 27, 82, 119]);

// Chunk sizing (must match protocol constants)
const MEMO_CHUNK_SIZE = 600;
const V3_HEADER_SIZE = 15;
const MEMO_PAYLOAD_SIZE = MEMO_CHUNK_SIZE - V3_HEADER_SIZE; // 585B usable per chunk

// ── Status enum mapping ──

const JOB_STATUSES: JobStatus[] = [
  "open",
  "claimed",
  "submitted",
  "completed",
  "cancelled",
  "expired",
  "disputed",
];

// ── Parsers ──

function parseConfig(address: PublicKey, data: Buffer): ConfigInfo | null {
  if (data.length < 8 + 32) return null;
  if (!data.subarray(0, 8).equals(CONFIG_DISCRIMINATOR)) return null;

  let offset = 8; // skip discriminator

  const authority = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const treasury = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const registryProgram = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const inscriberFeeBps = data.readUInt16LE(offset);
  offset += 2;

  const indexerFeeBps = data.readUInt16LE(offset);
  offset += 2;

  const treasuryFeeBps = data.readUInt16LE(offset);
  offset += 2;

  const referralFeeBps = data.readUInt16LE(offset);
  offset += 2;

  const minAttestations = data[offset];
  offset += 1;

  const jobExpirySeconds = Number(data.readBigInt64LE(offset));
  offset += 8;

  const totalJobsCreated = Number(data.readBigUInt64LE(offset));
  offset += 8;

  const totalJobsCompleted = Number(data.readBigUInt64LE(offset));
  offset += 8;

  const bump = data[offset];
  offset += 1;

  // v3 fields (after bump)
  const minEscrowLamports = (offset + 8 <= data.length)
    ? Number(data.readBigUInt64LE(offset)) : 0;
  offset += 8;

  const defaultExclusiveWindow = (offset + 4 <= data.length)
    ? data.readUInt32LE(offset) : 0;
  offset += 4;

  const maxExclusiveWindow = (offset + 4 <= data.length)
    ? data.readUInt32LE(offset) : 0;

  return {
    address,
    authority,
    treasury,
    registryProgram,
    inscriberFeeBps,
    indexerFeeBps,
    treasuryFeeBps,
    referralFeeBps,
    minAttestations,
    jobExpirySeconds,
    totalJobsCreated,
    totalJobsCompleted,
    bump,
    minEscrowLamports,
    defaultExclusiveWindow,
    maxExclusiveWindow,
  };
}

function parseJobAccount(address: PublicKey, data: Buffer): JobInfo | null {
  if (data.length < 8 + 8 + 32) return null;
  if (!data.subarray(0, 8).equals(JOB_DISCRIMINATOR)) return null;

  let offset = 8; // skip discriminator

  const jobId = Number(data.readBigUInt64LE(offset));
  offset += 8;

  const creator = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const writer = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  // content_hash (4-byte len prefix + UTF-8)
  const hashLen = data.readUInt32LE(offset);
  offset += 4;
  const contentHash = data.subarray(offset, offset + hashLen).toString("utf8");
  offset += hashLen;

  const chunkCount = data.readUInt32LE(offset);
  offset += 4;

  const escrowLamports = Number(data.readBigUInt64LE(offset));
  offset += 8;

  const statusVal = data[offset];
  offset += 1;
  const status = JOB_STATUSES[statusVal] ?? "open";

  const createdAt = Number(data.readBigInt64LE(offset));
  offset += 8;

  const claimedAt = Number(data.readBigInt64LE(offset));
  offset += 8;

  const submittedAt = Number(data.readBigInt64LE(offset));
  offset += 8;

  const completedAt = Number(data.readBigInt64LE(offset));
  offset += 8;

  const attestationCount = data[offset];
  offset += 1;

  // pointer_sig (4-byte len prefix + UTF-8)
  const sigLen = data.readUInt32LE(offset);
  offset += 4;
  const pointerSig = data.subarray(offset, offset + sigLen).toString("utf8");
  offset += sigLen;

  const bump = data[offset];
  offset += 1;

  const referrer = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  // v3 fields
  const assignedNode = (offset + 32 <= data.length)
    ? new PublicKey(data.subarray(offset, offset + 32)) : null;
  if (assignedNode) offset += 32;
  const exclusiveUntil = (offset + 8 <= data.length)
    ? Number(data.readBigInt64LE(offset)) : 0;
  if (offset + 8 <= data.length) offset += 8;

  // blob_source (4-byte len prefix + UTF-8)
  let blobSource = "";
  if (offset + 4 <= data.length) {
    const bsLen = data.readUInt32LE(offset);
    offset += 4;
    if (bsLen > 0 && offset + bsLen <= data.length) {
      blobSource = data.subarray(offset, offset + bsLen).toString("utf8");
    }
  }

  return {
    address,
    jobId,
    creator,
    writer,
    contentHash,
    chunkCount,
    escrowLamports,
    status,
    createdAt,
    claimedAt,
    submittedAt,
    completedAt,
    attestationCount,
    pointerSig,
    bump,
    referrer,
    assignedNode,
    exclusiveUntil,
    blobSource,
  };
}

function parseAttestation(
  address: PublicKey,
  data: Buffer
): AttestationInfo | null {
  if (data.length < 8 + 8 + 32 + 1 + 8 + 1) return null;
  if (!data.subarray(0, 8).equals(ATTEST_DISCRIMINATOR)) return null;

  let offset = 8; // skip discriminator

  const jobId = Number(data.readBigUInt64LE(offset));
  offset += 8;

  const reader = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const isValid = data[offset] === 1;
  offset += 1;

  const attestedAt = Number(data.readBigInt64LE(offset));
  offset += 8;

  const bump = data[offset];

  return { address, jobId, reader, isValid, attestedAt, bump };
}

// ── Fetch functions ──

/**
 * Fetch the global Config PDA.
 */
export async function fetchConfig(
  connection: Connection,
  programId: PublicKey = PROGRAM_ID
): Promise<ConfigInfo | null> {
  const [pda] = deriveConfigPDA(programId);
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  return parseConfig(pda, info.data as Buffer);
}

/**
 * Fetch a single job by its ID.
 */
export async function fetchJob(
  connection: Connection,
  jobId: number | bigint,
  programId: PublicKey = PROGRAM_ID
): Promise<JobInfo | null> {
  const [pda] = deriveJobPDA(jobId, programId);
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  return parseJobAccount(pda, info.data as Buffer);
}

/**
 * Fetch all jobs from the program. Optionally filter by status.
 */
export async function fetchAllJobs(
  connection: Connection,
  statusFilter?: JobStatus,
  programId: PublicKey = PROGRAM_ID
): Promise<JobInfo[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { memcmp: { offset: 0, bytes: JOB_DISCRIMINATOR.toString("base64"), encoding: "base64" } },
    ],
  });

  const jobs: JobInfo[] = [];
  for (const { pubkey, account } of accounts) {
    const parsed = parseJobAccount(pubkey, account.data as Buffer);
    if (parsed) {
      if (!statusFilter || parsed.status === statusFilter) {
        jobs.push(parsed);
      }
    }
  }

  return jobs;
}

/**
 * Fetch all open jobs (available for writers to claim).
 */
export async function fetchOpenJobs(
  connection: Connection,
  programId: PublicKey = PROGRAM_ID
): Promise<JobInfo[]> {
  return fetchAllJobs(connection, "open", programId);
}

/**
 * Fetch all attestations for a specific job.
 */
export async function fetchJobAttestations(
  connection: Connection,
  jobId: number | bigint,
  programId: PublicKey = PROGRAM_ID
): Promise<AttestationInfo[]> {
  const jobIdBuf = Buffer.alloc(8);
  jobIdBuf.writeBigUInt64LE(BigInt(jobId));

  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { memcmp: { offset: 0, bytes: ATTEST_DISCRIMINATOR.toString("base64"), encoding: "base64" } },
      { memcmp: { offset: 8, bytes: jobIdBuf.toString("base64"), encoding: "base64" } },
    ],
  });

  const attestations: AttestationInfo[] = [];
  for (const { pubkey, account } of accounts) {
    const parsed = parseAttestation(pubkey, account.data as Buffer);
    if (parsed) attestations.push(parsed);
  }

  return attestations;
}

// ── TX Builders ──

export interface BuildCreateJobTxOpts {
  connection: Connection;
  creator: PublicKey;
  contentHash: string;
  chunkCount: number;
  escrowLamports: number;
  /** URL where nodes fetch the blob. Empty string = nodes use fallback cascade. */
  blobSource?: string;
  referrer?: PublicKey;
  assignedNode?: PublicKey;
  exclusiveWindow?: number;
  programId?: PublicKey;
}

/**
 * Build an unsigned create_job transaction.
 * The caller signs with their wallet and sends — no server wallet needed.
 */
export async function buildCreateJobTx(
  opts: BuildCreateJobTxOpts
): Promise<{ transaction: Transaction; jobPDA: PublicKey; jobId: number }> {
  const {
    connection,
    creator,
    contentHash,
    chunkCount,
    escrowLamports,
    blobSource = "",
    referrer,
    assignedNode,
    exclusiveWindow = 0,
    programId = PROGRAM_ID,
  } = opts;

  // Read config to get job counter + treasury + min escrow
  const config = await fetchConfig(connection, programId);
  if (!config) throw new Error("Jobs program Config PDA not found — not initialized");

  if (config.minEscrowLamports > 0 && escrowLamports < config.minEscrowLamports) {
    throw new Error(
      `Escrow ${escrowLamports} below minimum ${config.minEscrowLamports} lamports`
    );
  }

  const jobId = config.totalJobsCreated;
  const [jobPDA] = deriveJobPDA(jobId, programId);
  const [configPDA] = deriveConfigPDA(programId);

  // Resolve referrer — defaults to treasury if not provided
  const referrerPubkey = referrer ?? config.treasury;
  // Resolve assigned node — defaults to Pubkey.default (all zeros = open marketplace)
  const assignedNodePubkey = assignedNode ?? PublicKey.default;

  // Derive referrer_account PDA (5th account required by CreateJob)
  let referrerAccountPubkey: PublicKey;
  if (referrerPubkey.equals(PublicKey.default) || referrerPubkey.equals(config.treasury)) {
    referrerAccountPubkey = SystemProgram.programId; // placeholder when no custom referrer
  } else {
    [referrerAccountPubkey] = deriveReferrerPDA(referrerPubkey, programId);
  }

  // Serialize content_hash as Borsh string (4-byte LE length prefix + UTF-8)
  const hashStr = contentHash.replace(/^sha256:/, "").slice(0, 64);
  const hashBytes = Buffer.from(hashStr, "utf8");
  const blobSourceBytes = Buffer.from(blobSource, "utf8");

  // IX data layout: 8 disc + (4+N) hash + 4 u32 + 8 u64 + 32 pk + 32 pk + 4 u32 + (4+M) blob_source
  const ixData = Buffer.alloc(8 + 4 + hashBytes.length + 4 + 8 + 32 + 32 + 4 + 4 + blobSourceBytes.length);
  let off = 0;
  IX_CREATE_JOB.copy(ixData, off); off += 8;
  ixData.writeUInt32LE(hashBytes.length, off); off += 4;
  hashBytes.copy(ixData, off); off += hashBytes.length;
  ixData.writeUInt32LE(chunkCount, off); off += 4;
  ixData.writeBigUInt64LE(BigInt(escrowLamports), off); off += 8;
  referrerPubkey.toBuffer().copy(ixData, off); off += 32;
  assignedNodePubkey.toBuffer().copy(ixData, off); off += 32;
  ixData.writeUInt32LE(exclusiveWindow, off); off += 4;
  ixData.writeUInt32LE(blobSourceBytes.length, off); off += 4;
  blobSourceBytes.copy(ixData, off);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: jobPDA, isSigner: false, isWritable: true },
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: referrerAccountPubkey, isSigner: false, isWritable: false },
    ],
    data: ixData,
  });

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: creator })
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }))
    .add(ix);

  return { transaction: tx, jobPDA, jobId };
}

export interface CalculateEscrowOpts {
  connection: Connection;
  blobSizeBytes: number;
  programId?: PublicKey;
}

/**
 * Calculate chunk count and minimum escrow for a given blob size.
 * Reads the on-chain Config PDA to get the protocol minimum.
 */
export async function calculateEscrow(
  opts: CalculateEscrowOpts
): Promise<{ chunkCount: number; minEscrowLamports: number }> {
  const { connection, blobSizeBytes, programId = PROGRAM_ID } = opts;
  const config = await fetchConfig(connection, programId);
  if (!config) throw new Error("Jobs program Config PDA not found — not initialized");

  const chunkCount = Math.ceil(blobSizeBytes / MEMO_PAYLOAD_SIZE);
  return {
    chunkCount,
    minEscrowLamports: config.minEscrowLamports,
  };
}
