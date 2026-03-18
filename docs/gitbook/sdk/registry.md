# @freezedry/registry

Read the on-chain node registry. Fetch registered nodes, check activity, and get identity data.

## Install

```bash
npm install @freezedry/registry
```

## Usage

```typescript
import { Connection } from '@solana/web3.js';
import {
  fetchAllNodes,
  fetchActiveNodes,
  fetchActiveNodesWithIdentity,
  fetchNode,
  displayName,
  PROGRAM_ID,
} from '@freezedry/registry';

const connection = new Connection('https://api.mainnet-beta.solana.com');

// List all registered nodes
const allNodes = await fetchAllNodes(connection);

// Active nodes only (heartbeat within 24h)
const active = await fetchActiveNodes(connection);

// Active nodes enriched with identity data from coordinator
const enriched = await fetchActiveNodesWithIdentity(connection);
for (const node of enriched) {
  console.log(`${node.displayName} (${node.identityPubkey}) — ${node.url}`);
}

// Single node by operator wallet
const node = await fetchNode(connection, ownerPubkey);

// Display name from any identity pubkey
const name = displayName('YourNodeIdentityPubkeyXXXXXXXXXXXXXXXXXXXXXXX');
// → "brave-tiger"
```

## Types

### NodeInfo

On-chain PDA data for a registered node.

```typescript
interface NodeInfo {
  address: PublicKey;        // PDA address
  wallet: PublicKey;         // Operator wallet
  nodeId: string;            // Human-readable ID
  url: string;               // Public HTTPS URL
  role: NodeRole;            // "reader" | "writer" | "both"
  registeredAt: number;      // Unix timestamp
  lastHeartbeat: number;     // Unix timestamp
  isActive: boolean;
  artworksIndexed: number;
  artworksComplete: number;
  bump: number;              // PDA bump seed
}
```

### NodeInfoWithIdentity

Extended with P2P discovery fields from the off-chain coordinator.

```typescript
interface NodeInfoWithIdentity extends NodeInfo {
  identityPubkey?: string;    // Ed25519 identity for peer auth
  hotWalletPubkey?: string;   // Hot wallet for TX signing
  endpoint?: string;          // IP:port for domain-free nodes
  displayName?: string;       // Deterministic name from identity
}
```

## Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `fetchAllNodes(connection)` | `NodeInfo[]` | All registered nodes from on-chain PDA |
| `fetchActiveNodes(connection, maxAge?)` | `NodeInfo[]` | Active nodes (heartbeat within cutoff) |
| `fetchActiveNodesWithIdentity(connection, coordUrl?)` | `NodeInfoWithIdentity[]` | Active nodes enriched with identity data |
| `fetchNode(connection, wallet)` | `NodeInfo \| null` | Single node by operator wallet |
| `displayName(pubkey)` | `string` | Deterministic adjective-animal name |
| `deriveNodePDA(wallet)` | `[PublicKey, number]` | Derive PDA address for a wallet |
