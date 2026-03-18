# Fee Economics

FreezeDry uses a two-step payment model: TX cost reimbursement (guaranteed to the writer) plus a margin split by basis points.

## Escrow Formula

```
escrow = max(min_escrow, chunks × 7,500 lamports)
```

- **min_escrow:** 15,385,000 lamports (~$2 USD floor)
- **Rate:** 7,500 lamports/chunk (5,000 TX reimbursement + 2,500 margin)

## Two-Step Payment Split

On job completion, escrow is split in two steps:

### Step 1 — TX Reimbursement (pass-through)

```
reimbursement = chunks × base_tx_fee (5,000 lamports)
```

Paid entirely to the writer. Covers actual Solana TX costs. Non-negotiable.

### Step 2 — Margin Split (by BPS)

```
margin = escrow - reimbursement
```

Split by basis points locked at job creation:

| Recipient | BPS | % | Per-chunk (at 7,500/chunk) |
|-----------|-----|---|---------------------------|
| Writer | 4,000 | 40% | 1,000 lamports |
| Attester | 1,000 | 10% | 250 lamports |
| Treasury | 3,000 | 30% | 750 lamports |
| Referral | 2,000 | 20% | 500 lamports |

No referrer → referral share redirects to treasury.

**Writer total:** 6,000 lamports/chunk (5,000 reimburse + 1,000 margin).

## Cost Examples

| File Size | Chunks | Escrow (SOL) | Cost @$130/SOL |
|-----------|--------|-------------|----------------|
| 500 KB | 876 | 0.01539 | $2.00 (min floor) |
| 1 MB | 1,793 | 0.01539 | $2.00 (min floor) |
| 5 MB | 8,962 | 0.06722 | $8.74 |
| 10 MB | 17,924 | 0.13443 | $17.48 |
| 15 MB | 26,886 | 0.20165 | $26.21 |

## Direct Inscription (No Marketplace)

If you inscribe directly (send memo TXs yourself), there is no escrow and no fee split. You pay only Solana network fees: ~5,000 lamports per memo transaction. This is roughly 43% cheaper than marketplace pricing.

The Jobs marketplace is for platforms processing at scale where dedicated node operators handle the volume. Direct inscription is for anyone who wants to run their own node or use the standalone tool.

## Key Design Decisions

- **Fee BPS snapshot:** Locked at job creation. Authority cannot change splits mid-flight.
- **Escrow floor enforced on-chain:** Program rejects jobs where `escrow <= chunks × base_tx_fee`.
- **Self-referral blocked:** Creator cannot set themselves as referrer.
- **Writer always gets reimbursed:** TX costs come off the top before any split.
