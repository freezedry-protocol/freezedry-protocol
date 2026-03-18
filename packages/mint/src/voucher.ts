/**
 * @freezedry/mint — Voucher NFTs (Inscription Passes)
 *
 * Mint, detect, and redeem voucher NFTs that grant free inscriptions.
 * Uses Metaplex Core Attributes plugin for on-chain status tracking.
 *
 * Flow:
 * 1. Authority mints voucher NFTs (mintVoucher)
 * 2. Distribute to users (airdrop, partnership, etc.)
 * 3. User connects wallet → site detects active voucher (findActiveVouchers)
 * 4. User inscribes → authority redeems voucher (redeemVoucher)
 * 5. NFT attribute updates: "active" → "redeemed" (stays in wallet as proof)
 */

import type { ProgressCallback } from './types.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface VoucherConfig {
  /** Metaplex Core authority wallet (must be update authority to redeem) */
  authority: string;
  /** Max blob size in KB this voucher covers (0 = unlimited) */
  maxBlobKb?: number;
  /** Voucher name (default: "Freeze Dry Pass") */
  name?: string;
  /** Optional collection address to group vouchers */
  collection?: string;
}

export interface VoucherInfo {
  /** NFT address */
  address: string;
  /** Current status: "active" or "redeemed" */
  status: 'active' | 'redeemed';
  /** Max blob size in KB (0 = unlimited) */
  maxBlobKb: number;
  /** NFT name */
  name: string;
  /** When redeemed, the inscription hash */
  inscriptionHash?: string;
  /** When redeemed, timestamp */
  redeemedAt?: string;
}

export interface MintVoucherOptions {
  /** Wallet adapter (authority — signs the mint) */
  wallet: any;
  /** RPC endpoint URL */
  rpc: string;
  /** Recipient wallet address (who gets the voucher) */
  recipient: string;
  /** Upload function for voucher metadata */
  uploadMetadata: (bytes: Uint8Array, contentType: string) => Promise<string>;
  /** Voucher configuration */
  config?: VoucherConfig;
  /** Progress callback */
  onProgress?: ProgressCallback;
}

export interface MintVoucherResult {
  /** NFT address of the minted voucher */
  nftAddress: string;
  /** Metadata URI */
  metadataUri: string;
}

export interface RedeemVoucherOptions {
  /** Voucher NFT address */
  voucherAddress: string;
  /** Wallet adapter (must be update authority) */
  wallet: any;
  /** RPC endpoint URL */
  rpc: string;
  /** Hash of the inscription this voucher is being redeemed for */
  inscriptionHash: string;
  /** File size in KB (validated against voucher max_blob_kb) */
  fileSizeKb?: number;
  /** Progress callback */
  onProgress?: ProgressCallback;
}

export interface RedeemVoucherResult {
  /** Voucher NFT address */
  voucherAddress: string;
  /** Transaction signature */
  txSignature: string;
}

export interface ServerRedeemOptions {
  /** Voucher NFT address */
  voucherAddress: string;
  /** Authority keypair secret key (Uint8Array) — signs the update TX */
  authoritySecret: Uint8Array;
  /** RPC endpoint URL */
  rpc: string;
  /** Hash of the inscription this voucher is being redeemed for */
  inscriptionHash: string;
  /** File size in KB (validated against voucher max_blob_kb) */
  fileSizeKb?: number;
  /** Progress callback */
  onProgress?: ProgressCallback;
}

export interface RedemptionRequest {
  /** Voucher NFT address to redeem */
  voucherAddress: string;
  /** Inscription hash to redeem for */
  inscriptionHash: string;
  /** File size in KB */
  fileSizeKb: number;
  /** User's wallet address (must own the voucher) */
  userWallet: string;
  /** Signed message from the user proving intent */
  signature: Uint8Array;
  /** The message that was signed */
  message: string;
}

// ── Voucher attribute constants ─────────────────────────────────────────

const VOUCHER_TYPE_KEY = 'type';
const VOUCHER_TYPE_VALUE = 'freezedry-inscription-voucher';
const VOUCHER_STATUS_KEY = 'status';
const VOUCHER_MAX_KB_KEY = 'max_blob_kb';

// ── Mint voucher ────────────────────────────────────────────────────────

/**
 * Mint a new voucher NFT for a recipient.
 * Authority signs the mint and retains update authority (needed for redemption).
 */
export async function mintVoucher(opts: MintVoucherOptions): Promise<MintVoucherResult> {
  const {
    wallet,
    rpc,
    recipient,
    uploadMetadata,
    config = {} as VoucherConfig,
    onProgress = () => {},
  } = opts;

  const voucherName = config.name || 'Freeze Dry Pass';
  const maxBlobKb = config.maxBlobKb || 0;

  onProgress('Building voucher metadata...', 10);

  const metadata = {
    name: voucherName,
    description: 'Redeem for one free inscription on the Freeze Dry Protocol. Lossless on-chain art storage on Solana.',
    image: '', // Optional — can add a voucher image
    attributes: [
      { trait_type: 'Type', value: 'Inscription Voucher' },
      { trait_type: 'Status', value: 'Active' },
      { trait_type: 'Max Size', value: maxBlobKb > 0 ? `${maxBlobKb} KB` : 'Unlimited' },
    ],
    properties: {
      category: 'ticket',
      freezedry_voucher: {
        type: VOUCHER_TYPE_VALUE,
        status: 'active',
        max_blob_kb: maxBlobKb,
      },
    },
  };

  onProgress('Uploading metadata...', 30);
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const metadataUri = await uploadMetadata(metadataBytes, 'application/json');

  onProgress('Initializing Metaplex...', 50);

  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { walletAdapterIdentity } = await import('@metaplex-foundation/umi-signer-wallet-adapters');
  const { mplCore, createV1 } = await import('@metaplex-foundation/mpl-core');
  const { generateSigner, publicKey } = await import('@metaplex-foundation/umi');

  const umi = createUmi(rpc).use(mplCore()).use(walletAdapterIdentity(wallet));

  onProgress('Minting voucher NFT (approve in wallet)...', 65);

  const assetSigner = generateSigner(umi);

  const createArgs: any = {
    asset: assetSigner,
    name: voucherName,
    uri: metadataUri,
    plugins: [
      {
        type: 'Attributes',
        attributeList: [
          { key: VOUCHER_TYPE_KEY, value: VOUCHER_TYPE_VALUE },
          { key: VOUCHER_STATUS_KEY, value: 'active' },
          { key: VOUCHER_MAX_KB_KEY, value: String(maxBlobKb) },
        ],
      },
    ],
  };

  // If recipient is different from authority, set owner
  if (recipient && recipient !== wallet.publicKey?.toBase58()) {
    createArgs.owner = publicKey(recipient);
  }

  // If collection specified, add it
  if (config.collection) {
    createArgs.collection = publicKey(config.collection);
  }

  await createV1(umi, createArgs).sendAndConfirm(umi);

  const nftAddress = assetSigner.publicKey.toString();
  onProgress('Voucher minted!', 100);

  return { nftAddress, metadataUri };
}

// ── Find active vouchers in a wallet ────────────────────────────────────

/**
 * Scan a wallet for active Freeze Dry voucher NFTs using the DAS API.
 * Returns vouchers sorted by maxBlobKb (largest first).
 */
export async function findActiveVouchers(
  rpc: string,
  ownerWallet: string,
  authorityWallet?: string,
): Promise<VoucherInfo[]> {
  // Use DAS getAssetsByOwner
  const resp = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAssetsByOwner',
      params: {
        ownerAddress: ownerWallet,
        limit: 100,
        displayOptions: { showUnverifiedCollections: true },
      },
    }),
  });

  const { result } = await resp.json();
  if (!result?.items) return [];

  const vouchers: VoucherInfo[] = [];

  for (const asset of result.items) {
    // Must be Metaplex Core
    if (asset.interface !== 'MplCoreAsset') continue;

    // Check authority if specified
    if (authorityWallet) {
      const hasAuthority = asset.authorities?.some(
        (a: any) => a.address === authorityWallet && a.scopes?.includes('full'),
      );
      if (!hasAuthority) continue;
    }

    // Check on-chain attributes for voucher type
    const attrs = asset.content?.metadata?.attributes || [];
    const onChainAttrs = asset.plugins?.attributes?.data?.attribute_list || [];

    // Check on-chain attributes first (more reliable)
    const typeAttr = onChainAttrs.find((a: any) => a.key === VOUCHER_TYPE_KEY);
    if (!typeAttr || typeAttr.value !== VOUCHER_TYPE_VALUE) continue;

    const statusAttr = onChainAttrs.find((a: any) => a.key === VOUCHER_STATUS_KEY);
    const status = statusAttr?.value === 'redeemed' ? 'redeemed' : 'active';

    const maxKbAttr = onChainAttrs.find((a: any) => a.key === VOUCHER_MAX_KB_KEY);
    const maxBlobKb = parseInt(maxKbAttr?.value || '0', 10) || 0;

    const hashAttr = onChainAttrs.find((a: any) => a.key === 'inscription_hash');
    const redeemedAtAttr = onChainAttrs.find((a: any) => a.key === 'redeemed_at');

    vouchers.push({
      address: asset.id,
      status,
      maxBlobKb,
      name: asset.content?.metadata?.name || 'Freeze Dry Pass',
      inscriptionHash: hashAttr?.value,
      redeemedAt: redeemedAtAttr?.value,
    });
  }

  // Active first, then by maxBlobKb descending
  return vouchers
    .filter((v) => v.status === 'active')
    .sort((a, b) => b.maxBlobKb - a.maxBlobKb);
}

// ── Build redemption message ─────────────────────────────────────────────

/**
 * Build the message a user signs to prove they want to redeem a voucher.
 * Both frontend and server use this to ensure the same message format.
 */
export function buildRedemptionMessage(
  voucherAddress: string,
  inscriptionHash: string,
  fileSizeKb: number,
): string {
  return [
    'Freeze Dry — Voucher Redemption',
    '',
    `Voucher: ${voucherAddress}`,
    `Inscription: ${inscriptionHash}`,
    `File size: ${fileSizeKb} KB`,
    '',
    'By signing this message you confirm you are redeeming',
    'your Freeze Dry Pass for this inscription.',
    `Timestamp: ${Date.now()}`,
  ].join('\n');
}

// ── Verify redemption request ────────────────────────────────────────────

/**
 * Verify a user's signed redemption request.
 * Call this server-side before executing redeemVoucherServer().
 *
 * Checks: signature valid, voucher exists and is active, user owns it,
 * file size within voucher limit, authority matches.
 */
export async function verifyRedemptionRequest(
  request: RedemptionRequest,
  rpc: string,
  expectedAuthority: string,
): Promise<{ valid: boolean; error?: string; voucher?: VoucherInfo }> {
  const { voucherAddress, inscriptionHash, fileSizeKb, userWallet, signature, message } = request;

  // 1. Verify the signed message contains the right voucher + hash
  if (!message.includes(voucherAddress) || !message.includes(inscriptionHash)) {
    return { valid: false, error: 'Signed message does not match request parameters' };
  }

  // 2. Verify ed25519 signature
  try {
    const { PublicKey } = await import('@solana/web3.js');
    const nacl = await import('tweetnacl') as any;
    const userPk = new PublicKey(userWallet);
    const messageBytes = new TextEncoder().encode(message);
    const valid = nacl.sign.detached.verify(messageBytes, signature, userPk.toBytes());
    if (!valid) return { valid: false, error: 'Invalid signature' };
  } catch {
    return { valid: false, error: 'Signature verification failed' };
  }

  // 3. Check voucher on-chain via DAS
  const resp = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'getAsset',
      params: { id: voucherAddress },
    }),
  });

  const { result: asset } = await resp.json();
  if (!asset) return { valid: false, error: 'Voucher NFT not found' };

  // 4. Must be Core NFT
  if (asset.interface !== 'MplCoreAsset') {
    return { valid: false, error: 'Not a Metaplex Core asset' };
  }

  // 5. Check authority
  const hasAuthority = asset.authorities?.some(
    (a: any) => a.address === expectedAuthority && a.scopes?.includes('full'),
  );
  if (!hasAuthority) {
    return { valid: false, error: 'Voucher not issued by this authority' };
  }

  // 6. Check ownership
  if (asset.ownership?.owner !== userWallet) {
    return { valid: false, error: 'User does not own this voucher' };
  }

  // 7. Check attributes
  const attrs = asset.plugins?.attributes?.data?.attribute_list || [];
  const typeAttr = attrs.find((a: any) => a.key === VOUCHER_TYPE_KEY);
  if (!typeAttr || typeAttr.value !== VOUCHER_TYPE_VALUE) {
    return { valid: false, error: 'Not a Freeze Dry voucher' };
  }

  const statusAttr = attrs.find((a: any) => a.key === VOUCHER_STATUS_KEY);
  if (statusAttr?.value === 'redeemed') {
    return { valid: false, error: 'Voucher already redeemed' };
  }

  // 8. Check size limit
  const maxKbAttr = attrs.find((a: any) => a.key === VOUCHER_MAX_KB_KEY);
  const maxBlobKb = parseInt(maxKbAttr?.value || '0', 10) || 0;
  if (maxBlobKb > 0 && fileSizeKb > maxBlobKb) {
    return { valid: false, error: `File ${fileSizeKb} KB exceeds voucher limit of ${maxBlobKb} KB` };
  }

  return {
    valid: true,
    voucher: {
      address: voucherAddress,
      status: 'active',
      maxBlobKb,
      name: asset.content?.metadata?.name || 'Freeze Dry Pass',
    },
  };
}

// ── Redeem a voucher (wallet adapter — browser) ──────────────────────────

/**
 * Redeem a voucher NFT by updating its Attributes plugin.
 * Must be called by the update authority (your server/wallet).
 * The NFT stays in the user's wallet as proof of redemption.
 */
export async function redeemVoucher(opts: RedeemVoucherOptions): Promise<RedeemVoucherResult> {
  const {
    voucherAddress,
    wallet,
    rpc,
    inscriptionHash,
    fileSizeKb,
    onProgress = () => {},
  } = opts;

  onProgress('Initializing Metaplex...', 10);

  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { walletAdapterIdentity } = await import('@metaplex-foundation/umi-signer-wallet-adapters');
  const { mplCore, updatePlugin, fetchAssetV1 } = await import('@metaplex-foundation/mpl-core');
  const { publicKey } = await import('@metaplex-foundation/umi');

  const umi = createUmi(rpc).use(mplCore()).use(walletAdapterIdentity(wallet));
  const assetPk = publicKey(voucherAddress);

  // Verify it's an active voucher
  onProgress('Verifying voucher...', 25);
  let asset: any;
  try {
    asset = await fetchAssetV1(umi, assetPk);
  } catch {
    throw new Error('Voucher NFT not found or not accessible');
  }

  // Check current attributes
  const currentAttrs = (asset as any).attributes?.attributeList || [];
  const typeAttr = currentAttrs.find((a: any) => a.key === VOUCHER_TYPE_KEY);
  if (!typeAttr || typeAttr.value !== VOUCHER_TYPE_VALUE) {
    throw new Error('NFT is not a Freeze Dry voucher');
  }

  const statusAttr = currentAttrs.find((a: any) => a.key === VOUCHER_STATUS_KEY);
  if (statusAttr?.value === 'redeemed') {
    throw new Error('Voucher has already been redeemed');
  }

  // Check size limit
  const maxKbAttr = currentAttrs.find((a: any) => a.key === VOUCHER_MAX_KB_KEY);
  const maxBlobKb = parseInt(maxKbAttr?.value || '0', 10) || 0;
  if (fileSizeKb && maxBlobKb > 0 && fileSizeKb > maxBlobKb) {
    throw new Error(`File ${fileSizeKb} KB exceeds voucher limit of ${maxBlobKb} KB`);
  }

  // Update attributes to mark as redeemed
  onProgress('Updating voucher (approve in wallet)...', 50);

  const result = await updatePlugin(umi, {
    asset: assetPk,
    plugin: {
      type: 'Attributes',
      attributeList: [
        { key: VOUCHER_TYPE_KEY, value: VOUCHER_TYPE_VALUE },
        { key: VOUCHER_STATUS_KEY, value: 'redeemed' },
        { key: VOUCHER_MAX_KB_KEY, value: maxKbAttr?.value || '0' },
        { key: 'inscription_hash', value: inscriptionHash },
        { key: 'redeemed_at', value: String(Date.now()) },
      ],
    },
  }).sendAndConfirm(umi);

  const txSignature = result.signature ?
    Buffer.from(result.signature).toString('base58' as BufferEncoding) : '';

  onProgress('Voucher redeemed!', 100);

  return { voucherAddress, txSignature };
}

// ── Redeem a voucher (server-side — keypair identity) ────────────────────

/**
 * Server-side redemption using authority keypair directly.
 * Use after verifyRedemptionRequest() confirms the user's signed request.
 */
export async function redeemVoucherServer(opts: ServerRedeemOptions): Promise<RedeemVoucherResult> {
  const {
    voucherAddress,
    authoritySecret,
    rpc,
    inscriptionHash,
    fileSizeKb,
    onProgress = () => {},
  } = opts;

  onProgress('Initializing Metaplex...', 10);

  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { mplCore, updatePlugin, fetchAssetV1 } = await import('@metaplex-foundation/mpl-core');
  const { publicKey, keypairIdentity } = await import('@metaplex-foundation/umi');

  const umi = createUmi(rpc).use(mplCore());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(authoritySecret);
  umi.use(keypairIdentity(umiKeypair));

  const assetPk = publicKey(voucherAddress);

  onProgress('Verifying voucher...', 25);
  let asset: any;
  try {
    asset = await fetchAssetV1(umi, assetPk);
  } catch {
    throw new Error('Voucher NFT not found');
  }

  const currentAttrs = (asset as any).attributes?.attributeList || [];
  const typeAttr = currentAttrs.find((a: any) => a.key === VOUCHER_TYPE_KEY);
  if (!typeAttr || typeAttr.value !== VOUCHER_TYPE_VALUE) {
    throw new Error('Not a Freeze Dry voucher');
  }

  const statusAttr = currentAttrs.find((a: any) => a.key === VOUCHER_STATUS_KEY);
  if (statusAttr?.value === 'redeemed') {
    throw new Error('Voucher already redeemed');
  }

  const maxKbAttr = currentAttrs.find((a: any) => a.key === VOUCHER_MAX_KB_KEY);
  const maxBlobKb = parseInt(maxKbAttr?.value || '0', 10) || 0;
  if (fileSizeKb && maxBlobKb > 0 && fileSizeKb > maxBlobKb) {
    throw new Error(`File ${fileSizeKb} KB exceeds voucher limit of ${maxBlobKb} KB`);
  }

  onProgress('Redeeming voucher on-chain...', 50);

  const result = await updatePlugin(umi, {
    asset: assetPk,
    plugin: {
      type: 'Attributes',
      attributeList: [
        { key: VOUCHER_TYPE_KEY, value: VOUCHER_TYPE_VALUE },
        { key: VOUCHER_STATUS_KEY, value: 'redeemed' },
        { key: VOUCHER_MAX_KB_KEY, value: maxKbAttr?.value || '0' },
        { key: 'inscription_hash', value: inscriptionHash },
        { key: 'redeemed_at', value: String(Date.now()) },
      ],
    },
  }).sendAndConfirm(umi);

  const txSignature = result.signature ?
    Buffer.from(result.signature).toString('base58' as BufferEncoding) : '';

  onProgress('Voucher redeemed!', 100);

  return { voucherAddress, txSignature };
}
