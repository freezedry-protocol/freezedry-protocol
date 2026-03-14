import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    '@solana/web3.js',
    '@metaplex-foundation/umi',
    '@metaplex-foundation/umi-bundle-defaults',
    '@metaplex-foundation/umi-signer-wallet-adapters',
    '@metaplex-foundation/mpl-core',
    '@metaplex-foundation/mpl-token-metadata',
  ],
});
