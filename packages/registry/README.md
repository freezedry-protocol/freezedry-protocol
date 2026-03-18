# @freezedry/registry

Solana on-chain node registry client for the [FreezeDry Protocol](https://github.com/freezedry-protocol/freezedry-protocol).

Read registered nodes, check availability, and discover writers/readers on the network.

## Install

```bash
npm install @freezedry/registry @solana/web3.js
```

## Quick Start

```ts
import { fetchAllNodes, fetchActiveNodes, fetchNode } from '@freezedry/registry';

const rpcUrl = 'https://api.mainnet-beta.solana.com';

// List all registered nodes
const allNodes = await fetchAllNodes(rpcUrl);
console.log(`${allNodes.length} nodes registered`);

// Filter to active nodes (heartbeat within 24h)
const active = await fetchActiveNodes(rpcUrl);
for (const node of active) {
  console.log(`${node.nodeId} (${node.role}) — ${node.url}`);
}

// Look up a specific node by operator wallet
const node = await fetchNode(rpcUrl, 'YourNodeOperatorWalletPubkey');
if (node) {
  console.log(`${node.nodeId}: ${node.artworksComplete} artworks inscribed`);
}
```

## Node Roles

| Role | Description |
|------|-------------|
| `reader` | Verifies inscriptions, submits attestations |
| `writer` | Claims jobs, inscribes memo transactions |
| `both` | Full node — reads and writes |

## On-Chain Program

- **Program ID:** `6UGJUc28AuCj8a8sjhsVEKbvYHfQECCuJC7i54vk2to`
- **Network:** Solana Mainnet
- **PDA Seed:** `["freeze-node", wallet]`

## API

### `fetchAllNodes(rpcUrl, programId?)`
Fetch all registered node PDAs.

### `fetchActiveNodes(rpcUrl, opts?)`
Fetch nodes with recent heartbeats.
- **opts.maxAge** — Maximum heartbeat age in seconds (default: 86400 = 24h)
- **opts.programId** — Custom program ID

### `fetchNode(rpcUrl, wallet, programId?)`
Fetch a single node by operator wallet address.

### `deriveNodePDA(wallet, programId?)`
Compute PDA address for a node. Seed: `["freeze-node", wallet]`.

### NodeInfo

```ts
interface NodeInfo {
  address: string;        // PDA address
  wallet: string;         // Operator wallet
  nodeId: string;         // Human-readable ID
  url: string;            // Public endpoint
  role: 'reader' | 'writer' | 'both';
  registeredAt: number;   // Unix timestamp
  lastHeartbeat: number;  // Unix timestamp
  isActive: boolean;
  artworksIndexed: number;
  artworksComplete: number;
}
```

## License

MIT
