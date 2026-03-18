/**
 * @freezedry/registry — Solana on-chain node registry client
 *
 * Read and interact with the Freeze Dry node registry PDAs.
 *
 * @example
 * ```ts
 * import { fetchAllNodes, fetchNode, deriveNodePDA, PROGRAM_ID } from '@freezedry/registry';
 *
 * // List all registered nodes
 * const nodes = await fetchAllNodes(connection);
 *
 * // Fetch a specific node by operator wallet
 * const node = await fetchNode(connection, ownerPubkey);
 *
 * // Derive PDA for a wallet
 * const [pda, bump] = deriveNodePDA(ownerPubkey);
 * ```
 */

export { PROGRAM_ID, deriveNodePDA } from "./pda.js";
export {
  fetchAllNodes,
  fetchActiveNodes,
  fetchActiveNodesWithIdentity,
  fetchNode,
  displayName,
} from "./client.js";
export type { NodeInfo, NodeInfoWithIdentity, NodeRole } from "./client.js";
