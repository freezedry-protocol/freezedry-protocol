# FreezeDry Protocol

FreezeDry inscribes files directly to the Solana blockchain using memo transactions. The complete file — every byte — lives on-chain. If every server, CDN, and frontend disappears, the data survives and can be reconstructed from the ledger alone.

## How It Works

1. **Preserve** — File is wrapped into a `.hyd` blob (49-byte header + raw file bytes)
2. **Shred** — Blob is split into 585-byte chunks, base64-encoded into memo transactions
3. **Inscribe** — Memo transactions are sent to Solana (one per chunk)
4. **Point** — A pointer memo indexes everything: hash, chunk count, inscriber
5. **Hydrate** — Any client reconstructs the original file from chain data alone

## Two Paths to Inscription

### Direct Inscription
Send memo transactions yourself. No middleman, no escrow, no protocol fee. Pay only Solana network fees (~5,000 lamports/chunk). Use the [standalone tool](https://freezedry.art/tools) or build your own client with the SDK.

### Marketplace (Jobs Program)
For platforms processing at scale. Create a job with escrow, a community node does the work. Fee split: Writer 40% / Attester 10% / Treasury 30% / Referral 20%.

## Core Principles

- **Chain is truth.** Memos are the ledger. Everything else is convenience.
- **Permissionless.** Anyone can write memos, run a node, or build a client.
- **Economics over enforcement.** Make honest behavior profitable.
- **Artists first.** Art is culture, culture is permanent.

## Resources

- [freezedry.art](https://freezedry.art) — Full app with managed infrastructure
- [Standalone Tool](https://freezedry.art/tools) — Zero-dependency inscriber + hydrator
- [GitHub: freezedry-node](https://github.com/freezedry-protocol/freezedry-node) — Run your own node
- [GitHub: freezedry-gallery](https://github.com/freezedry-protocol/freezedry-gallery) — Personal art vault (template)
- [GitHub: freezedry-protocol](https://github.com/freezedry-protocol/freezedry-protocol) — SDK + Anchor programs
