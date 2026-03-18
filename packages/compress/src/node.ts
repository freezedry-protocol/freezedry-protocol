/**
 * @freezedry/compress/node — Node.js entrypoint with sharp-based AVIF codec
 *
 * @example
 * ```ts
 * import { freezedry, hydrate } from '@freezedry/compress';
 * import { nodeCodec } from '@freezedry/compress/node';
 *
 * const result = await freezedry(pixelData, nodeCodec, { mode: 'open' });
 * const original = await hydrate(result.blob, nodeCodec);
 * ```
 */

export { nodeCodec } from './codec-node.js';
