# Running a Node

FreezeDry nodes index the Solana blockchain for inscribed data and serve it to peers over HTTP. The chain is the source of truth; nodes are a discovery and caching layer.

## Prerequisites

- **Node.js v18+**
- **Helius API key** — Free at [helius.dev](https://helius.dev)

Writer nodes also need:
- **Funded Solana wallet** (~0.1 SOL for testing, ~1 SOL for production)

## Quick Start

```bash
git clone https://github.com/freezedry-protocol/freezedry-node.git
cd freezedry-node
npm run setup    # guided wizard — generates identity key, hot wallet, .env
npm start
```

The setup wizard walks you through:
1. **Role selection** — reader, writer, or both
2. **Helius key** — paste your API key
3. **Identity keypair** — generated automatically (peer auth + reputation)
4. **Hot wallet** — generated automatically (writer: TX signing + escrow earnings)
5. **Network config** — domain URL or IP:port for peer discovery

## Roles

| Role | What it does | Helius plan | Wallet needed? |
|------|-------------|-------------|----------------|
| **reader** | Index chain + serve artwork to peers | Free works | No |
| **writer** | Accept inscription jobs, earn fees | Developer+ | Yes (funded) |
| **both** | Reader + writer (default) | Developer+ | Yes (funded) |

Reader-only is the simplest way to help the network. No wallet, no SOL, just a Helius key.

## Verify It's Working

```bash
curl http://localhost:3100/health
```

```json
{
  "status": "ok",
  "indexed": { "artworks": 19, "complete": 19 },
  "peers": 2,
  "identityPubkey": "YourIdent...",
  "displayName": "brave-tiger"
}
```

## Network Connectivity

Choose one method for peers to reach your node:

### Option A: Domain (HTTPS)

```bash
# In .env
NODE_URL=https://node.yourdomain.com
```

Requires DNS + SSL certificate + reverse proxy (nginx). See [Deployment Modes](deployment-modes.md) for nginx config.

### Option B: IP:port (simplest)

```bash
# In .env
NODE_ENDPOINT=203.0.113.5:3100
```

No domain, no SSL, no reverse proxy. Just your public IP and port. Identity signatures provide authentication.

## Writer Economics

Your hot wallet needs SOL as working capital to send memo transactions. You get reimbursed from the job escrow:

- **5,000 lamports/chunk** — TX cost reimbursement (pass-through)
- **1,000 lamports/chunk** — Writer margin (40% of profit split)
- **Total: 6,000 lamports/chunk** earned per chunk inscribed

Start with ~0.1 SOL for testing, ~1 SOL for production.

## Next Steps

- [Peer Authentication](peer-auth.md) — How nodes prove identity to each other
- [Deployment Modes](deployment-modes.md) — Private, public, and hybrid setups
