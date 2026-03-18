/**
 * @freezedry/mint — Metaplex NFT minting with embedded Freeze Dry manifest
 *
 * Mint new NFTs or update existing ones with the full on-chain proof manifest.
 * Upload functions are dependency-injected — use your own Arweave, IPFS, or S3.
 *
 * @example
 * ```ts
 * import { mintNFT, extractPreview } from '@freezedry/mint';
 *
 * const result = await mintNFT({
 *   blob: hydBlob,
 *   manifest: memoManifest,
 *   wallet: phantomWallet,
 *   rpc: rpcUrl,
 *   uploadPreview: (bytes, type) => uploadToArweave(bytes, type),
 *   uploadMetadata: (bytes, type) => uploadToArweave(bytes, type),
 * });
 * ```
 */

export { mintNFT } from './mint.js';
export { updateNFT } from './update.js';
export { extractPreview } from './preview.js';
export {
  mintVoucher,
  findActiveVouchers,
  redeemVoucher,
  redeemVoucherServer,
  verifyRedemptionRequest,
  buildRedemptionMessage,
} from './voucher.js';

export type {
  ProgressCallback,
  UploadFn,
  MemoManifest,
  MintNFTOptions,
  MintResult,
  UpdateNFTOptions,
  UpdateResult,
} from './types.js';

export type {
  VoucherConfig,
  VoucherInfo,
  MintVoucherOptions,
  MintVoucherResult,
  RedeemVoucherOptions,
  RedeemVoucherResult,
  ServerRedeemOptions,
  RedemptionRequest,
} from './voucher.js';
