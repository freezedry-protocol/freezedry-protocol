/**
 * @freezedry/mint — Types
 */

/** Progress callback */
export type ProgressCallback = (step: string, pct: number) => void;

/** Upload function — user provides their own storage backend */
export type UploadFn = (bytes: Uint8Array, contentType: string) => Promise<string>;

/** Memo manifest from @freezedry/solana */
export interface MemoManifest {
  hash: string;
  signatures: string[];
  chunkCount?: number;
  blobSize?: number;
  network?: string;
}

/** Options for minting a new NFT */
export interface MintNFTOptions {
  blob: Uint8Array;
  manifest: MemoManifest;
  wallet: any; // WalletAdapter — kept as any to avoid hard Metaplex dep in types
  rpc: string;
  name?: string;
  width?: number;
  height?: number;
  mode?: string;
  uploadPreview: UploadFn;
  uploadMetadata: UploadFn;
  /** Base URL for external_url in metadata (default: https://freezedry.art) */
  baseUrl?: string;
  onProgress?: ProgressCallback;
}

/** Result from minting */
export interface MintResult {
  nftAddress: string;
  imageUri: string;
  metadataUri: string;
}

/** Options for updating an existing NFT */
export interface UpdateNFTOptions {
  nftAddress: string;
  manifest: MemoManifest;
  wallet: any;
  rpc: string;
  existingMetadata?: Record<string, unknown>;
  replaceImage?: boolean;
  imageUrl?: string;
  uploadMetadata: UploadFn;
  onProgress?: ProgressCallback;
}

/** Result from updating */
export interface UpdateResult {
  nftAddress: string;
  metadataUri: string;
  txSig: string;
}
