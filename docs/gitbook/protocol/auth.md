# Auth & Identity

All write operations in the FreezeDry protocol require cryptographic proof of identity using ed25519 signatures.

## Message Format

```
FreezeDry:{action}:{identifier}:{timestamp}:{nonce}
```

| Field | Description |
|-------|-------------|
| `action` | Operation being performed (e.g. `node-register`, `artwork-register`) |
| `identifier` | Context-specific ID (wallet address, node URL, content hash) |
| `timestamp` | Unix epoch seconds |
| `nonce` | Random hex string (prevents replay) |

## Verification

1. **Signature** — Ed25519 verify against the claimed public key
2. **Timestamp** — Must be within 5 minutes of server time
3. **Nonce** — Must not have been seen before (in-memory tracking, auto-cleaned)
4. **Authorization** — Signer must have permission for the action

## Node Peer Auth

Node-to-node communication uses the same ed25519 scheme with dedicated HTTP headers. See [Peer Authentication](../nodes/peer-auth.md) for the full specification.

### Headers

```
X-FD-Identity:  <base58 identity pubkey>
X-FD-Message:   FreezeDry:peer:<action>:<timestamp>:<nonce>
X-FD-Signature: <base64 ed25519 signature>
```

### Two-Wallet Separation

Nodes use separate keypairs for peer auth (identity key) and Solana transactions (hot wallet). This isolates reputation from funds — a compromised hot wallet doesn't affect node identity.

## Browser Wallet Auth

Frontend operations (artwork registration, job creation) use the connected Solana wallet:

```javascript
// Browser signs with Phantom/Solflare
const message = `FreezeDry:artwork-register:${hash}:${timestamp}:${nonce}`;
const encoded = new TextEncoder().encode(message);
const signature = await wallet.signMessage(encoded);
```

The server verifies using the same ed25519 scheme. The wallet's public key is the identity.
