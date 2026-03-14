/**
 * @freezedry/mint — Update an existing NFT with Freeze Dry manifest
 *
 * Supports Metaplex Core (MplCoreAsset) and Token Metadata (V1NFT, ProgrammableNFT).
 * Upload function is dependency-injected — not hardcoded to any storage backend.
 */

import type { UpdateNFTOptions, UpdateResult, ProgressCallback } from './types.js';

/**
 * Update an existing NFT to embed the Freeze Dry manifest.
 * You must be the update authority for the NFT.
 *
 * Supports 3 NFT standards:
 * - MplCoreAsset (Metaplex Core)
 * - V1NFT (Token Metadata v1)
 * - ProgrammableNFT (pNFT)
 *
 * @example
 * ```ts
 * import { updateNFT } from '@freezedry/mint';
 *
 * const result = await updateNFT({
 *   nftAddress: 'ABC123...',
 *   manifest: memoManifest,
 *   wallet: phantomWallet,
 *   rpc: rpcUrl,
 *   uploadMetadata: async (bytes, type) => 'https://arweave.net/...',
 * });
 * ```
 */
export async function updateNFT(opts: UpdateNFTOptions): Promise<UpdateResult> {
  const {
    nftAddress,
    manifest,
    wallet,
    rpc,
    existingMetadata = {},
    replaceImage = false,
    imageUrl,
    uploadMetadata,
    onProgress = () => {},
  } = opts;

  const progress: ProgressCallback = onProgress;
  const { hash } = manifest;

  progress('Fetching NFT from chain...', 10);

  // 1. Fetch current NFT via DAS getAsset
  const dasResp = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAsset',
      params: { id: nftAddress },
    }),
  });
  if (!dasResp.ok) throw new Error(`DAS request failed (${dasResp.status})`);
  const dasResult = await dasResp.json();
  const asset = dasResult.result || dasResult;
  if (asset.error) throw new Error(`DAS error: ${asset.error.message || JSON.stringify(asset.error)}`);

  // 2. Detect NFT standard
  const iface: string = asset.interface || '';
  const supportedInterfaces = ['MplCoreAsset', 'V1NFT', 'ProgrammableNFT'];
  if (!supportedInterfaces.includes(iface)) {
    throw new Error(
      `NFT type '${iface}' is not supported. Use Export Metadata to add Freeze Dry data manually.`,
    );
  }

  // 3. Verify update authority
  const connectedWallet = wallet.publicKey?.toString?.() || wallet.publicKey;
  const authorities = asset.authorities || [];
  const fullAuth = authorities.find((a: any) =>
    a.scopes && (a.scopes.includes('full') || a.scopes.includes('metadata')),
  );
  if (!fullAuth || fullAuth.address !== connectedWallet) {
    throw new Error(
      `You are not the update authority for this NFT. Authority: ${fullAuth?.address || 'unknown'}`,
    );
  }

  progress('Merging metadata...', 30);

  // 4. Merge existing metadata with Freeze Dry manifest
  const mergedMetadata: Record<string, unknown> = {
    ...existingMetadata,
    ...(replaceImage && imageUrl ? { image: imageUrl } : {}),
    properties: {
      ...((existingMetadata.properties as Record<string, unknown>) || {}),
      hydrate: {
        hash,
        signatures: manifest.signatures,
        network: manifest.network || 'mainnet',
        blobSize: manifest.blobSize,
        chunkCount: manifest.chunkCount || manifest.signatures?.length,
      },
    },
  };

  // 5. Upload merged metadata
  progress('Uploading new metadata...', 50);
  const metadataBytes = new TextEncoder().encode(JSON.stringify(mergedMetadata));
  const newMetadataUri = await uploadMetadata(metadataBytes, 'application/json');

  progress('Initializing Metaplex...', 65);

  let txSig: string;
  const meta = asset.content?.metadata || {};

  if (iface === 'MplCoreAsset') {
    // Metaplex Core update
    const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
    const { walletAdapterIdentity } = await import('@metaplex-foundation/umi-signer-wallet-adapters');
    const { mplCore, update, fetchAssetV1 } = await import('@metaplex-foundation/mpl-core');
    const { publicKey } = await import('@metaplex-foundation/umi');

    progress('Updating NFT (approve in wallet)...', 80);

    const umi = createUmi(rpc).use(mplCore()).use(walletAdapterIdentity(wallet));
    const assetAccount = await fetchAssetV1(umi, publicKey(nftAddress));
    const result = await update(umi, {
      asset: assetAccount,
      name: (existingMetadata.name as string) || meta.name || '',
      uri: newMetadataUri,
    }).sendAndConfirm(umi);
    txSig = Buffer.from(result.signature).toString('base64');
  } else {
    // Token Metadata updateV1 — for V1NFT and ProgrammableNFT
    // @ts-expect-error mpl-token-metadata is an optional peer dependency
    const mplTokenMetadataMod: any = await import('@metaplex-foundation/mpl-token-metadata');
    const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
    const { walletAdapterIdentity } = await import('@metaplex-foundation/umi-signer-wallet-adapters');
    const { publicKey, none } = await import('@metaplex-foundation/umi');

    progress('Updating NFT (approve in wallet)...', 80);

    const umi = createUmi(rpc).use(mplTokenMetadataMod.mplTokenMetadata()).use(walletAdapterIdentity(wallet));
    const result = await mplTokenMetadataMod.updateV1(umi, {
      mint: publicKey(nftAddress),
      data: {
        name: (existingMetadata.name as string) || meta.name || '',
        symbol: (existingMetadata.symbol as string) || meta.symbol || '',
        uri: newMetadataUri,
        sellerFeeBasisPoints: asset.royalty?.basis_points ?? 0,
        creators: none(),
      },
    }).sendAndConfirm(umi);
    txSig = Buffer.from(result.signature).toString('base64');
  }

  progress('NFT updated!', 100);

  return { nftAddress, metadataUri: newMetadataUri, txSig };
}
