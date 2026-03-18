/**
 * @freezedry/compress — Cryptographic primitives
 * SHA-256, PBKDF2 key derivation, AES-256-GCM encrypt/decrypt
 * Uses Web Crypto API (available in browsers + Node.js 18+)
 */

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

// Resolve crypto.subtle across environments
function getSubtle(): SubtleCrypto {
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    return globalThis.crypto.subtle;
  }
  throw new Error('Web Crypto API not available — requires browser or Node.js 18+');
}

function getRandomValues(buf: Uint8Array): Uint8Array {
  if (typeof globalThis.crypto?.getRandomValues !== 'undefined') {
    return globalThis.crypto.getRandomValues(buf);
  }
  throw new Error('crypto.getRandomValues not available');
}

/**
 * SHA-256 hash returning "sha256:hex..." string
 */
export async function sha256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = data instanceof ArrayBuffer ? data : data.buffer as ArrayBuffer;
  const hash = await getSubtle().digest('SHA-256', buffer);
  const hex = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

/**
 * Raw SHA-256 hash as 32-byte Uint8Array
 */
export async function sha256Raw(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const buffer = data instanceof ArrayBuffer ? data : data.buffer as ArrayBuffer;
  const hash = await getSubtle().digest('SHA-256', buffer);
  return new Uint8Array(hash);
}

/**
 * Derive AES-256-GCM key from password + salt via PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await getSubtle().importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return getSubtle().deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt plaintext with password.
 * Wire format: [salt:16B][iv:12B][ciphertext+tag]
 */
export async function encrypt(plaintext: ArrayBuffer | Uint8Array, password: string): Promise<ArrayBuffer> {
  const salt = getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);

  const ciphertext = await getSubtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext instanceof ArrayBuffer ? plaintext : plaintext.buffer as ArrayBuffer,
  );

  const result = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
  result.set(salt, 0);
  result.set(iv, SALT_LENGTH);
  result.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH);
  return result.buffer as ArrayBuffer;
}

/**
 * Decrypt data encrypted with encrypt().
 * Expects wire format: [salt:16B][iv:12B][ciphertext+tag]
 */
export async function decrypt(encrypted: ArrayBuffer | Uint8Array, password: string): Promise<ArrayBuffer> {
  const data = encrypted instanceof ArrayBuffer ? new Uint8Array(encrypted) : encrypted;

  if (data.byteLength < SALT_LENGTH + IV_LENGTH + 1) {
    throw new Error('Encrypted data too short');
  }

  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = data.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(password, salt);

  try {
    return await getSubtle().decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );
  } catch {
    throw new Error('Decryption failed — wrong password or corrupted data');
  }
}
