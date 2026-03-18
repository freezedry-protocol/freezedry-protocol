# FreezeDry — Standalone Tools

Self-contained HTML files that inscribe and reconstruct files on Solana. No servers, no installs, no build step. Open in a browser and go.

These are the insurance policy. If every server disappears, these files + a Solana RPC endpoint are all you need.

## `freezedry-standalone.html` (recommended)

**Inscribe + Hydrate in one file. Zero external dependencies.**

Everything runs in your browser using native Web Crypto APIs. No CDN imports, no npm, no wallet extension required.

### Inscribe Tab

Inscribe any file directly to Solana memo transactions from your browser.

- **Burner wallet** — generates a temporary Ed25519 keypair with BIP39 seed phrase (24 words, Phantom-compatible)
- **PIN-encrypted storage** — wallet is AES-256-GCM encrypted in localStorage, unlocked with your PIN on return
- **Checkpoint resume** — progress saved every 5 chunks. Close the tab, come back later, pick up where you left off
- **Fund reclaim** — send remaining SOL back to your main wallet when done
- **Open + Encrypted modes** — inscribe publicly (mode 3) or password-protected (mode 5)

#### How to use

1. Open the file in Chrome 113+ or Safari 17+ (needs Ed25519 Web Crypto support)
2. Set a PIN and click **Generate Burner Wallet**
3. **Write down your 24-word seed phrase** — it's the only way to recover funds
4. Send SOL to the displayed address from your main wallet (Phantom, Solflare, etc.)
5. Select a file, optionally set an encryption password, click **Inscribe to Chain**
6. When done, click **Download Signatures JSON** — this is your proof of inscription
7. **Reclaim remaining SOL** back to your main wallet
8. Click **Clear Wallet from Browser** when finished

#### Cost estimate

Each chunk costs ~0.000009 SOL (5,000 base fee + priority fee). Examples at current rates:

| Image Size | Chunks | Approx. Cost |
|-----------|--------|-------------|
| 100 KB | ~175 | ~0.002 SOL |
| 500 KB | ~876 | ~0.008 SOL |
| 1 MB | ~1,793 | ~0.016 SOL |
| 5 MB | ~8,962 | ~0.081 SOL |

Public Solana RPC is slow (~1 TX per 5 seconds). Use a [Helius](https://www.helius.dev/) or [QuickNode](https://www.quicknode.com/) RPC URL for faster inscription.

### Hydrate Tab

Reconstruct files from chain. Three lookup modes:

- **Signatures** — Paste a JSON array of transaction signatures or upload a signatures JSON file
- **Pointer Lookup** — Paste a single pointer signature. Auto-discovers all chunk transactions
- **NFT Lookup** — Paste a Metaplex Core NFT address. Reads inscriptionHash, finds pointer, hydrates automatically (requires DAS-compatible RPC)

Features:
- Open and encrypted blob support
- SHA-256 integrity verification
- Encrypted blobs prompt for password automatically
- Download reconstructed file

### Security

This is a **burner wallet tool for inscribing** — not a daily wallet.

- Private key never leaves your browser (Web Crypto `CryptoKey` is non-extractable)
- Seed phrase encrypted with your PIN (AES-256-GCM) before saving to localStorage
- No network calls except to the Solana RPC you provide — no telemetry, no analytics
- Clipboard auto-clears 60 seconds after copying seed phrase
- Browser warns before closing during active inscription
- "Clear Wallet" wipes all data from localStorage (checks balance first)

**Fund only what you need. Reclaim when done. Save your seed phrase offline.**

Without the seed phrase, there is no recovery. The PIN protects browser storage only — the seed phrase is the real key.

---

## Legacy Tools

### `hydrate.html`

Original standalone hydrator. Read-only — reconstructs files from transaction signatures. Superseded by the Hydrate tab in `freezedry-standalone.html`.

### `dehydrate.html`

Original standalone inscriber. Connects to Phantom wallet extension and uses `@solana/web3.js` from CDN. Superseded by the Inscribe tab in `freezedry-standalone.html` (which has zero external dependencies).

---

## How it works

```
File → .hyd blob (49-byte header + data) → 585-byte chunks → memo TXs → Solana
```

Each memo transaction carries one chunk in v3 format: `FD:{hash8}:{index}:{base64data}`

A pointer memo indexes the inscription: `FREEZEDRY:3:{hash}:{chunks}:{size}:585:{flags}:{inscriber}:{lastSig}`

To reconstruct: fetch memos by signature → reassemble chunks → verify SHA-256 → restore original file.

The chain is the source of truth. Everything else is optional.

## License

MIT
