/**
 * @freezedry/mint — Mint a Metaplex Core NFT with embedded Freeze Dry manifest
 *
 * Upload functions are passed in by the caller (not hardcoded to Arweave/Irys).
 * This lets integrators use their own storage — Arweave, IPFS, S3, whatever.
 */

import { extractPreview } from './preview.js';
import type { MintNFTOptions, MintResult, ProgressCallback } from './types.js';

/**
 * Mint a new Metaplex Core NFT embedding the Freeze Dry manifest.
 *
 * @example
 * ```ts
 * import { mintNFT } from '@freezedry/mint';
 *
 * const result = await mintNFT({
 *   blob: hydBlob,
 *   manifest: memoManifest,
 *   wallet: phantomWallet,
 *   rpc: 'https://mainnet.helius-rpc.com/?api-key=...',
 *   uploadPreview: async (bytes, type) => {
 *     // Upload to Arweave, IPFS, S3, etc.
 *     return 'https://arweave.net/...';
 *   },
 *   uploadMetadata: async (bytes, type) => {
 *     return 'https://arweave.net/...';
 *   },
 *   onProgress: (step, pct) => console.log(step, pct),
 * });
 *
 * console.log('NFT:', result.nftAddress);
 * ```
 */
export async function mintNFT(opts: MintNFTOptions): Promise<MintResult> {
  const {
    blob,
    manifest,
    wallet,
    rpc,
    name,
    width,
    height,
    mode = 'open',
    uploadPreview,
    uploadMetadata,
    onProgress = () => {},
  } = opts;

  const baseUrl = opts.baseUrl || 'https://freezedry.art';
  const progress: ProgressCallback = onProgress;
  const { hash, signatures, chunkCount, blobSize } = manifest;
  const shortHash = hash ? hash.slice(7, 19) : 'unknown';
  const nftName = name || `Freeze Dry #${shortHash}`;

  // 1. Extract and upload AVIF preview
  progress('Extracting preview...', 5);
  let imageUri: string;
  const avifBytes = extractPreview(blob);

  if (avifBytes && avifBytes.length > 0) {
    progress('Uploading preview...', 15);
    imageUri = await uploadPreview(avifBytes, 'image/avif');
  } else {
    // Encrypted blob — caller should provide a fallback image URL
    imageUri = '';
  }

  progress('Building NFT metadata...', 30);

  // 2. Build NFT metadata JSON (Metaplex standard)
  const attributes: Array<{ trait_type: string; value: string | number }> = [
    { trait_type: 'Protocol', value: 'Freeze Dry' },
    { trait_type: 'Mode', value: mode },
    { trait_type: 'Chunks', value: chunkCount || signatures.length },
  ];
  if (width && height) {
    attributes.push({ trait_type: 'Dimensions', value: `${width}x${height}` });
  }
  if (blobSize) {
    attributes.push({ trait_type: 'Blob Size', value: `${blobSize} bytes` });
  }

  const metadata = {
    name: nftName,
    description: 'On-chain art compressed with Freeze Dry. SHA-256 verified. Reconstruct the original at freezedry.art',
    image: imageUri,
    external_url: `${baseUrl}/v/${encodeURIComponent(hash)}`,
    attributes,
    properties: {
      files: [{ uri: imageUri, type: 'image/avif' }],
      category: 'image',
      hydrate_manifest: {
        protocol: 'hydrate',
        version: 1,
        storage: 'memo',
        hash,
        signatures,
        chunkCount: chunkCount || signatures.length,
      },
    },
  };

  // 3. Upload metadata JSON
  progress('Uploading metadata...', 45);
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const metadataUri = await uploadMetadata(metadataBytes, 'application/json');

  // 4. Mint Metaplex Core NFT
  progress('Initializing Metaplex...', 60);

  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { walletAdapterIdentity } = await import('@metaplex-foundation/umi-signer-wallet-adapters');
  const { mplCore, createV1 } = await import('@metaplex-foundation/mpl-core');
  const { generateSigner } = await import('@metaplex-foundation/umi');

  const umi = createUmi(rpc).use(mplCore()).use(walletAdapterIdentity(wallet));

  progress('Minting NFT (approve in wallet)...', 70);

  const assetSigner = generateSigner(umi);
  await createV1(umi, {
    asset: assetSigner,
    name: nftName,
    uri: metadataUri,
  }).sendAndConfirm(umi);

  const nftAddress = assetSigner.publicKey.toString();

  progress('NFT minted!', 100);

  return { nftAddress, imageUri, metadataUri };
}
