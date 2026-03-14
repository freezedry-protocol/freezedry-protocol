/**
 * @freezedry/jobs — On-chain inscription job marketplace client
 *
 * Read and interact with Freeze Dry inscription job PDAs.
 *
 * @example
 * ```ts
 * import {
 *   fetchConfig, fetchJob, fetchOpenJobs, fetchAllJobs,
 *   deriveConfigPDA, deriveJobPDA, deriveAttestationPDA,
 *   PROGRAM_ID,
 * } from '@freezedry/jobs';
 *
 * // Read marketplace config
 * const config = await fetchConfig(connection);
 *
 * // List open jobs available for writers
 * const openJobs = await fetchOpenJobs(connection);
 *
 * // Fetch a specific job by ID
 * const job = await fetchJob(connection, 0);
 *
 * // Derive PDAs
 * const [configPDA] = deriveConfigPDA();
 * const [jobPDA] = deriveJobPDA(0);
 * const [attestPDA] = deriveAttestationPDA(0, readerPubkey);
 * ```
 */

export {
  PROGRAM_ID,
  deriveConfigPDA,
  deriveJobPDA,
  deriveAttestationPDA,
  deriveReferrerPDA,
} from "./pda.js";

export {
  fetchConfig,
  fetchJob,
  fetchAllJobs,
  fetchOpenJobs,
  fetchJobAttestations,
  buildCreateJobTx,
  calculateEscrow,
} from "./client.js";

export type {
  ConfigInfo,
  JobInfo,
  AttestationInfo,
  JobStatus,
  BuildCreateJobTxOpts,
  CalculateEscrowOpts,
} from "./client.js";
