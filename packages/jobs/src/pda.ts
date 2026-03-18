import { PublicKey } from "@solana/web3.js";

/** Mainnet Jobs program ID (v4 — deployed 2026-03-01) */
export const PROGRAM_ID = new PublicKey(
  "AmqBYKYCqpmKoFcgvripCQ3bJC2d8ygWWhcoHtmTvvzx"
);

/** PDA seed prefixes */
const SEED_CONFIG = Buffer.from("fd-config");
const SEED_JOB = Buffer.from("fd-job");
const SEED_ATTEST = Buffer.from("fd-attest");
const SEED_REFERRER = Buffer.from("fd-referrer");

/**
 * Derive the global Config PDA.
 * Seeds: ["fd-config"]
 */
export function deriveConfigPDA(
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED_CONFIG], programId);
}

/**
 * Derive a JobAccount PDA for a given job ID.
 * Seeds: ["fd-job", job_id.to_le_bytes()]
 */
export function deriveJobPDA(
  jobId: number | bigint,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(jobId));
  return PublicKey.findProgramAddressSync([SEED_JOB, buf], programId);
}

/**
 * Derive a VerificationAttestation PDA.
 * Seeds: ["fd-attest", job_id.to_le_bytes(), reader_wallet]
 */
export function deriveAttestationPDA(
  jobId: number | bigint,
  reader: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(jobId));
  return PublicKey.findProgramAddressSync(
    [SEED_ATTEST, buf, reader.toBuffer()],
    programId
  );
}

/**
 * Derive a ReferrerAccount PDA.
 * Seeds: ["fd-referrer", wallet]
 */
export function deriveReferrerPDA(
  wallet: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_REFERRER, wallet.toBuffer()],
    programId
  );
}
