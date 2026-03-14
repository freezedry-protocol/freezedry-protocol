import { Connection, PublicKey, GetProgramAccountsFilter } from "@solana/web3.js";
import { PROGRAM_ID, deriveNodePDA } from "./pda.js";

/** Matches the on-chain NodeRole enum */
export type NodeRole = "reader" | "writer" | "both";

/** Parsed node account data */
export interface NodeInfo {
  /** PDA address of the node account */
  address: PublicKey;
  /** Node operator wallet */
  wallet: PublicKey;
  /** Human-readable node identifier */
  nodeId: string;
  /** Public URL of the node (https://) */
  url: string;
  /** Node role */
  role: NodeRole;
  /** Unix timestamp when registered */
  registeredAt: number;
  /** Unix timestamp of last heartbeat */
  lastHeartbeat: number;
  /** Whether the node is currently active */
  isActive: boolean;
  /** Number of artworks indexed */
  artworksIndexed: number;
  /** Number of artworks with complete data */
  artworksComplete: number;
  /** PDA bump */
  bump: number;
}

/**
 * Extended node info with P2P discovery fields.
 * These fields come from the off-chain coordinator, not the PDA.
 * Use fetchActiveNodesWithIdentity() to get enriched data.
 */
export interface NodeInfoWithIdentity extends NodeInfo {
  /** Ed25519 identity pubkey for peer auth (base58) */
  identityPubkey?: string;
  /** Hot wallet pubkey for TX signing / escrow earnings (base58) */
  hotWalletPubkey?: string;
  /** IP:port endpoint for domain-free nodes */
  endpoint?: string;
  /** Deterministic display name from identity pubkey hash */
  displayName?: string;
}

/** 8-byte account discriminator for NodeAccount */
const NODE_ACCOUNT_DISCRIMINATOR = Buffer.from([
  125, 166, 18, 146, 195, 127, 86, 220,
]);

/**
 * Parse raw account data into NodeInfo.
 * Layout: 8 disc + 32 wallet + (4+len) nodeId + (4+len) url + 1 role
 *         + 8 registeredAt + 8 lastHeartbeat + 1 isActive
 *         + 8 artworksIndexed + 8 artworksComplete + 1 bump + 64 reserved
 */
function parseNodeAccount(
  address: PublicKey,
  data: Buffer
): NodeInfo | null {
  if (data.length < 8 + 32) return null;

  // Verify discriminator
  const disc = data.subarray(0, 8);
  if (!disc.equals(NODE_ACCOUNT_DISCRIMINATOR)) return null;

  let offset = 8;

  // wallet (32 bytes)
  const wallet = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  // nodeId (4-byte length prefix + UTF-8)
  const nodeIdLen = data.readUInt32LE(offset);
  offset += 4;
  const nodeId = data.subarray(offset, offset + nodeIdLen).toString("utf8");
  offset += nodeIdLen;

  // url (4-byte length prefix + UTF-8)
  const urlLen = data.readUInt32LE(offset);
  offset += 4;
  const url = data.subarray(offset, offset + urlLen).toString("utf8");
  offset += urlLen;

  // role (1 byte enum)
  const roleVal = data[offset];
  offset += 1;
  const roles: NodeRole[] = ["reader", "writer", "both"];
  const role = roles[roleVal] ?? "reader";

  // registeredAt (i64, 8 bytes)
  const registeredAt = Number(data.readBigInt64LE(offset));
  offset += 8;

  // lastHeartbeat (i64, 8 bytes)
  const lastHeartbeat = Number(data.readBigInt64LE(offset));
  offset += 8;

  // isActive (1 byte)
  const isActive = data[offset] === 1;
  offset += 1;

  // artworksIndexed (u64, 8 bytes)
  const artworksIndexed = Number(data.readBigUInt64LE(offset));
  offset += 8;

  // artworksComplete (u64, 8 bytes)
  const artworksComplete = Number(data.readBigUInt64LE(offset));
  offset += 8;

  // bump (1 byte)
  const bump = data[offset];

  return {
    address,
    wallet,
    nodeId,
    url,
    role,
    registeredAt,
    lastHeartbeat,
    isActive,
    artworksIndexed,
    artworksComplete,
    bump,
  };
}

/**
 * Fetch all registered nodes from the on-chain registry.
 */
export async function fetchAllNodes(
  connection: Connection,
  programId: PublicKey = PROGRAM_ID
): Promise<NodeInfo[]> {
  const filters: GetProgramAccountsFilter[] = [
    { memcmp: { offset: 0, bytes: NODE_ACCOUNT_DISCRIMINATOR.toString("base64"), encoding: "base64" } },
  ];

  const accounts = await connection.getProgramAccounts(programId, {
    filters,
  });

  const nodes: NodeInfo[] = [];
  for (const { pubkey, account } of accounts) {
    const parsed = parseNodeAccount(pubkey, account.data as Buffer);
    if (parsed) nodes.push(parsed);
  }

  return nodes;
}

/**
 * Fetch active nodes (heartbeat within cutoff period).
 * @param maxAgeSeconds — max seconds since last heartbeat (default 24h)
 */
export async function fetchActiveNodes(
  connection: Connection,
  maxAgeSeconds = 86400,
  programId: PublicKey = PROGRAM_ID
): Promise<NodeInfo[]> {
  const all = await fetchAllNodes(connection, programId);
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  return all.filter((n) => n.isActive && n.lastHeartbeat > cutoff);
}

/**
 * Fetch a single node by its operator wallet.
 */
export async function fetchNode(
  connection: Connection,
  ownerWallet: PublicKey,
  programId: PublicKey = PROGRAM_ID
): Promise<NodeInfo | null> {
  const [pda] = deriveNodePDA(ownerWallet, programId);
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  return parseNodeAccount(pda, info.data as Buffer);
}

// ── P2P Discovery helpers ────────────────────────────────────────────────────

const ADJECTIVES = [
  "bold","brave","bright","busy","calm","cool","dark","deep","dry","fair",
  "fast","fierce","firm","free","fresh","grand","great","green","grey","hard",
  "harsh","heavy","high","hot","keen","kind","late","lean","light","lone",
  "long","loud","low","mad","mild","neat","new","nice","noble","odd",
  "old","pale","plain","prime","proud","pure","quick","quiet","rare","raw",
  "real","red","rich","rough","round","royal","safe","sharp","shy","silent",
  "slim","slow","small","smart","smooth","soft","solid","sour","spare","stark",
  "steady","steep","stern","stiff","still","stone","stout","strong","sure","sweet",
  "swift","tall","thick","thin","tight","tiny","true","vast","vivid","warm",
  "weak","wet","whole","wide","wild","wise","worn","young","zero","zen",
];

const ANIMALS = [
  "ant","ape","bat","bear","bee","bird","boar","bull","cat","clam",
  "cobra","cod","colt","cow","crab","crane","crow","deer","dog","dove",
  "duck","eagle","eel","elk","emu","fawn","finch","fish","fly","fox",
  "frog","goat","goose","gull","hare","hawk","hen","hog","horse","ibis",
  "iguana","jay","kite","lark","lion","lynx","mink","mole","moth","mouse",
  "mule","newt","orca","osprey","otter","owl","ox","panda","parrot","perch",
  "pig","pike","pony","pug","quail","ram","rat","raven","ray","robin",
  "rook","seal","shark","sheep","shrew","sloth","slug","snail","snake","squid",
  "stag","stork","swan","teal","tiger","toad","trout","viper","wasp","whale",
  "wolf","worm","wren","yak","zebra","bass","carp","dace","dodo","flea",
];

/**
 * Derive a deterministic display name from an identity pubkey.
 * Uses SHA-256 hash → adjective + animal (~10,000 combos).
 * Works in both Node.js and browser (uses synchronous hash for Node).
 *
 * @param identityPubkey — base58 identity public key
 * @returns display name like "brave-tiger"
 */
export function displayName(identityPubkey: string): string {
  // Use a simple hash: sum of char codes modulo list lengths
  // (Deterministic, no crypto dependency needed for display names)
  let h1 = 0, h2 = 0;
  for (let i = 0; i < identityPubkey.length; i++) {
    const c = identityPubkey.charCodeAt(i);
    h1 = (h1 * 31 + c) >>> 0;
    h2 = (h2 * 37 + c) >>> 0;
  }
  return `${ADJECTIVES[h1 % ADJECTIVES.length]}-${ANIMALS[h2 % ANIMALS.length]}`;
}

/**
 * Fetch active nodes enriched with identity data from the coordinator.
 * Combines on-chain PDA data with off-chain coordinator fields.
 *
 * @param connection — Solana RPC connection
 * @param coordinatorUrl — coordinator base URL (default: https://freezedry.art)
 * @param maxAgeSeconds — max heartbeat age for PDA filter
 */
export async function fetchActiveNodesWithIdentity(
  connection: Connection,
  coordinatorUrl = "https://freezedry.art",
  maxAgeSeconds = 86400,
  programId: PublicKey = PROGRAM_ID
): Promise<NodeInfoWithIdentity[]> {
  // Fetch on-chain nodes
  const onChain = await fetchActiveNodes(connection, maxAgeSeconds, programId);

  // Fetch coordinator data for identity enrichment
  let coordNodes: Record<string, any> = {};
  try {
    const resp = await fetch(`${coordinatorUrl}/api/nodes?action=list`);
    if (resp.ok) {
      const data = await resp.json();
      for (const n of data.nodes || []) {
        if (n.nodeUrl) coordNodes[n.nodeUrl] = n;
      }
    }
  } catch {
    // Coordinator unavailable — return on-chain data only
  }

  return onChain.map((node) => {
    const coord = coordNodes[node.url];
    const enriched: NodeInfoWithIdentity = { ...node };
    if (coord) {
      enriched.identityPubkey = coord.identityPubkey || undefined;
      enriched.hotWalletPubkey = coord.hotWalletPubkey || undefined;
      enriched.endpoint = coord.endpoint || undefined;
      if (enriched.identityPubkey) {
        enriched.displayName = displayName(enriched.identityPubkey);
      }
    }
    return enriched;
  });
}
