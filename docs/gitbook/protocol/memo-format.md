# Memo Chunks (v3)

The blob is split into 585-byte chunks, base64-encoded, and written to Solana memo transactions.

## Chunk Format

```
FD:{hash8}:{index}:{base64data}
```

| Field | Size | Description |
|-------|------|-------------|
| `FD:` | 3 chars | Protocol prefix |
| `hash8` | 8 chars | First 8 hex chars of manifest SHA-256 (no `sha256:` prefix) |
| `index` | 2+ chars | Zero-padded chunk index ("00", "01", ...) |
| `base64data` | ~780 chars | Base64-encoded 585-byte raw chunk |

**Total per memo TX:** ~795 bytes (within Solana's 1,232 byte limit)

## Constants

```
MEMO_CHUNK_SIZE    = 600    (header + payload)
MEMO_PAYLOAD_SIZE  = 585    (raw bytes per chunk)
V3_HEADER_SIZE     = 15     (FD:{hash8}:{idx}:)
MEMO_PROGRAM_ID    = MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr
```

## Chunk Count

```
chunk_count = ceil(blob_bytes / 585)
```

Example: a 5 MB file produces a ~5 MB blob (49B header + file), requiring `ceil(5,242,929 / 585) = 8,963` memo transactions.

## Pointer Memo

After all chunks are confirmed, a single pointer memo is sent. This is the index — anyone can find all chunks from the pointer alone.

```
FREEZEDRY:3:{hash}:{chunkCount}:{blobSize}:{chunkSize}:{flags}:{inscriber}:{lastSig}
```

| Field | Description |
|-------|-------------|
| `hash` | Full manifest hash (`sha256:abcdef...`) |
| `chunkCount` | Number of chunks inscribed |
| `blobSize` | Total blob size in bytes |
| `chunkSize` | 585 (constant, for verification) |
| `flags` | Content type + encryption mode flags |
| `inscriber` | First 8 chars of inscriber's wallet address |
| `lastSig` | TX signature of the last chunk (for ordering/discovery) |

## Reconstruction (Hydration)

Three ways to reconstruct a file from chain:

### 1. From Signatures
Provide the JSON array of all chunk TX signatures. Fetch each TX, extract memo data, decode base64, reassemble in order.

### 2. From Pointer
Provide one pointer TX signature:
1. Fetch the pointer TX → parse `FREEZEDRY:3:` memo
2. Extract hash, chunk count, and inscriber wallet
3. Scan inscriber's TX history via `getSignaturesForAddress`
4. Match memos containing `FD:{hash8}:` prefix
5. Sort by chunk index → decode → reassemble

### 3. From NFT
Provide a Metaplex Core NFT mint address:
1. Call DAS `getAsset` → read `inscriptionHash` attribute
2. Find pointer memo in the inscription authority's TX history
3. Chain into pointer resolve (method 2 above)
