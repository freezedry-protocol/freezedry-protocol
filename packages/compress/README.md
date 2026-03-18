# @freezedry/compress

Preserve and hydrate engine for the [FreezeDry Protocol](https://github.com/freezedry-protocol/freezedry-protocol).

Preserves any file into a `.hyd` blob with a 49-byte header containing dimensions, mode, and SHA-256 hash. Supports open and encrypted modes. SHA-256 verified reconstruction.

## Install

```bash
npm install @freezedry/compress
```

## Usage

```ts
import { wrap, unwrap } from '@freezedry/compress';

// Preserve a file into a .hyd blob
const result = await wrap(fileBytes, {
  mode: 'open',
  width: 0,    // 0 for non-image files
  height: 0,
});

console.log('Blob size:', result.blob.byteLength);
console.log('Hash:', result.hash);

// Hydrate back to original
const original = await unwrap(result.blob);
console.log('Hash:', original.hash); // matches result.hash
```

## Encryption

```ts
const result = await wrap(fileBytes, {
  mode: 'encrypted',
  password: 'secret',
});

// Decryption requires the same password
const original = await unwrap(result.blob, 'secret');
```

Uses PBKDF2 (600K iterations) + AES-256-GCM. Encrypted blobs are indistinguishable from random noise — no metadata, no file size, no content type is exposed.

## How It Works

1. **Header** — 49-byte header with magic bytes, mode, dimensions, and SHA-256 hash
2. **Payload** — raw file bytes (open) or AES-256-GCM ciphertext (encrypted)
3. **Verification** — SHA-256 hash embedded in header, verified on reconstruction

Files are stored byte-for-byte. What goes in comes out identical.

## .hyd Binary Format

```
Offset  Size  Field
0-3     4     Magic: HYD\x01
4       1     Mode: 3=direct open, 5=direct encrypted
5-6     2     Width (uint16 LE) — 0 for non-image files
7-8     2     Height (uint16 LE) — 0 for non-image files
9-12    4     Reserved (uint32 LE, 0)
13-16   4     File length (uint32 LE)
17-48   32    SHA-256 hash (raw bytes)
49+     var   File bytes (open) or ciphertext (encrypted)
```

## API

### `wrap(data, opts?)`
Preserve file bytes into a `.hyd` blob.
- **data** — `Uint8Array` of file bytes
- **opts.mode** — `'open'` | `'encrypted'` (default: `'open'`)
- **opts.password** — Required for encrypted mode
- **opts.width** — Image width, 0 for non-image files
- **opts.height** — Image height, 0 for non-image files
- Returns `{ blob, hash }`

### `unwrap(blob, password?)`
Hydrate original file from `.hyd` blob.
- Returns `{ data, width, height, hash }`

### `parseHeader(data)`
Non-destructive header peek. Returns dimensions, mode, and sizes.

### `sha256(data)` / `sha256Raw(data)`
SHA-256 hash as hex string or raw bytes.

### `encrypt(data, password)` / `decrypt(data, password)`
AES-256-GCM with PBKDF2 key derivation.

## License

MIT
