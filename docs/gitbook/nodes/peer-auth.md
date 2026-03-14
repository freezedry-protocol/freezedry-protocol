# Peer Authentication

FreezeDry nodes authenticate to each other using **ed25519 signed messages** — the same cryptography Solana uses for wallet signatures. No shared passwords, no API keys, no central authority.

## Two-Wallet System

Each node operates with two separate keypairs:

| Key | Purpose | Needs SOL? | Risk if compromised |
|-----|---------|-----------|-------------------|
| **Identity key** | Peer authentication, reputation, display name | No | Node identity lost, but no funds at risk |
| **Hot wallet** | Signs Solana memo TXs, pays fees, earns escrow | Yes (writer only) | Funds at risk, but identity/reputation untouched |

**Why separate?** If your hot wallet gets drained (bad RPC, leaked key, etc.), your node's identity and reputation are untouched. Generate a new hot wallet, fund it, and keep going. Your peers still recognize you.

## How Peer Auth Works

Every node-to-node HTTP request includes three headers:

```
X-FD-Identity:  <base58 public key>
X-FD-Message:   FreezeDry:peer:<action>:<timestamp>:<nonce>
X-FD-Signature: <base64 ed25519 signature>
```

### Example

```
X-FD-Identity:  YourNodeIdentityPubkey1111111111111111111111
X-FD-Message:   FreezeDry:peer:blob-pull:1710288000:a1b2c3d4e5f6g7h8
X-FD-Signature: kD3m...base64...==
```

### Verification Steps

The receiving node checks:

1. **Format** — Message starts with `FreezeDry:peer:` and has 5 colon-separated parts
2. **Freshness** — Timestamp is within 5 minutes of current time
3. **Uniqueness** — Nonce hasn't been seen before (prevents replay attacks)
4. **Signature** — Ed25519 signature is valid for the claimed identity pubkey
5. **Known peer** — Identity pubkey exists in the local peer database

If any check fails, the request is rejected with a 403 status.

### Actions

| Action | Used by | Purpose |
|--------|---------|---------|
| `sync-push` | gossip.js | Push a complete blob to admin node |
| `sync-notify` | gossip.js | Notify admin about a new blob (hash only) |
| `sync-announce` | indexer.js | Announce this node to a peer |
| `blob-pull` | gossip.js, indexer.js | Request a blob from a peer |
| `gossip-peers` | indexer.js | Exchange peer lists |
| `manifest-pull` | indexer.js | Request artwork manifest from a peer |

## Display Names

Each node gets a deterministic display name derived from its identity pubkey — like `brave-tiger` or `silent-falcon`. These are cosmetic identifiers for human readability. The pubkey is always the canonical identity.

Display names are computed by hashing the base58 pubkey and mapping to adjective + animal word lists (~10,000 combinations). The same pubkey always produces the same name.

## Peer Discovery

Nodes find each other through three paths:

1. **Bootstrap peers** — `PEER_NODES` env var lists known nodes to connect to on startup
2. **Coordinator** — Nodes register with `freezedry.art` (centralized convenience, not required)
3. **Gossip** — Every ~20 minutes, nodes exchange peer lists to discover new nodes

### Announcing

When a node starts, it announces itself to all known peers:

```
POST /sync/announce
{
  "url": "https://node.example.com",        // or null
  "endpoint": "203.0.113.5:3100",           // or null
  "identityPubkey": "Bh174g...",
  "hotWalletPubkey": "HwVPB1..."
}
```

Headers include the signed identity proof. The receiving node verifies the signature matches the claimed `identityPubkey` before storing it.

## Connectivity Options

Nodes can be reached via domain or raw IP:

| Method | Config | Requires |
|--------|--------|----------|
| Domain | `NODE_URL=https://node.example.com` | DNS + SSL + reverse proxy |
| IP:port | `NODE_ENDPOINT=203.0.113.5:3100` | Public IP only |

IP:port nodes use plain HTTP (no SSL needed). The identity signature provides authentication — TLS is defense-in-depth, not required for auth.

## Security Properties

- **No shared secrets** — Each node proves its own identity. Compromising one node doesn't compromise others.
- **Replay protection** — Random nonce + timestamp prevents message reuse
- **SSRF hardening** — Private IPs, reserved ranges, `.internal`/`.local` hostnames all blocked
- **Known-peer gate** — Blob data only served to registered peers with valid signatures
- **Redirect protection** — All outbound peer fetches use `redirect: 'manual'` to prevent SSRF via redirects

## Configuration

```bash
# Identity key — peer auth, reputation. Never needs SOL.
IDENTITY_KEYPAIR=[1,2,...,64]

# Hot wallet — signs memo TXs, pays fees, earns escrow.
HOT_WALLET_KEYPAIR=[1,2,...,64]

# Legacy: WALLET_KEYPAIR works for both if separate keys aren't set
WALLET_KEYPAIR=[1,2,...,64]
```

Generate keypairs during setup (`npm run setup`) or manually:

```bash
node -e "
  const { Keypair } = require('@solana/web3.js');
  const kp = Keypair.generate();
  console.log('IDENTITY_KEYPAIR=' + JSON.stringify(Array.from(kp.secretKey)));
  console.log('# Identity pubkey: ' + kp.publicKey.toBase58());
"
```

**Save your identity keypair securely.** It's tied to your node's reputation. Losing it means starting fresh with a new identity.
