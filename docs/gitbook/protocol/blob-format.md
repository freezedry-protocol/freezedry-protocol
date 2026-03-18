# Blob Format (.hyd)

All files are preserved into a `.hyd` blob before inscription. The header is fixed at 49 bytes, little-endian.

```
Offset  Size   Field              Description
------  -----  -----------------  --------------------------------------
0-2     3B     Magic              "HYD" (0x48 0x59 0x44)
3       1B     Version            0x01
4       1B     Mode               3 = direct open, 5 = direct encrypted
5-6     2B     Width              u16 LE (0 for non-image files)
7-8     2B     Height             u16 LE (0 for non-image files)
9-12    4B     Reserved           u32 LE (0)
13-16   4B     File Length        u32 LE (original file size in bytes)
17-48   32B    SHA-256 Hash       Content hash (zeroed for encrypted mode)
49+     var    Body               Raw file bytes (open) or AES-256-GCM ciphertext (encrypted)
```

## Modes

| Mode | Value | Description |
|------|-------|-------------|
| Direct Open | 3 | Header readable, file bytes follow header in cleartext |
| Direct Encrypted | 5 | 5-byte header only (magic + mode), rest is AES-256-GCM ciphertext |

### Encrypted Mode

- **Key derivation:** PBKDF2 (600K iterations, SHA-256) from user password
- **Encryption:** AES-256-GCM
- **Ciphertext layout:** salt (16B) + IV (12B) + encrypted(width + height + reserved + fileLen + SHA-256 + file bytes) + auth tag (16B)
- No metadata exposed — file type, size, and content are indistinguishable from random noise

## Width/Height

- **Image files:** actual pixel dimensions
- **Non-image files:** width=0, height=0 (signals hydrator to offer download instead of render)

## Any File Type

The blob format supports any file type — images, text, PDFs, code, audio, video, anything. The header stores the original file size and a SHA-256 content hash for verification. The body is the raw file bytes (open mode) or encrypted ciphertext (encrypted mode).
