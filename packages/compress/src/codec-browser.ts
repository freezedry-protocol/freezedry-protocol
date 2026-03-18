/**
 * @freezedry/compress — Browser AVIF codec (WASM-based)
 *
 * Wraps @jsquash/avif WASM encoder/decoder.
 * Users must call init() with the path to WASM files before first use,
 * OR rely on bundler auto-resolution (Vite, Webpack handle WASM imports).
 *
 * WASM files shipped in the npm package under wasm/
 */

import type { PixelData, AvifCodec, AvifEncodeOptions } from './types.js';

// Emscripten module initializer (from @jsquash)
function initEmscriptenModule(
  moduleFactory: (opts: Record<string, unknown>) => unknown,
  wasmModule?: WebAssembly.Module,
  moduleOptionOverrides: Record<string, unknown> = {},
) {
  let instantiateWasm: ((imports: WebAssembly.Imports, callback: (instance: WebAssembly.Instance) => void) => WebAssembly.Exports) | undefined;
  if (wasmModule) {
    instantiateWasm = (imports, callback) => {
      const instance = new WebAssembly.Instance(wasmModule, imports);
      callback(instance);
      return instance.exports;
    };
  }
  return moduleFactory({
    noInitialRun: true,
    instantiateWasm,
    ...moduleOptionOverrides,
  });
}

// AVIF default encode options from @jsquash/avif@2.0.0
const AVIF_DEFAULTS = {
  quality: 50,
  qualityAlpha: -1,
  denoiseLevel: 0,
  tileColsLog2: 0,
  tileRowsLog2: 0,
  speed: 6,
  subsample: 1,
  chromaDeltaQ: false,
  sharpness: 0,
  tune: 0,
  enableSharpYUV: false,
};

// Module singletons
let _encModule: Promise<any> | null = null;
let _decModule: Promise<any> | null = null;
let _wasmBasePath: string | null = null;

/**
 * Initialize the browser codec with the base path to WASM files.
 * Call this once before any encode/decode operations.
 *
 * @param wasmPath - URL or path to directory containing avif_enc.wasm and avif_dec.wasm
 *
 * @example
 * // Using a CDN
 * init({ wasmPath: '/wasm/' });
 *
 * // Bundlers like Vite handle WASM automatically — no init needed
 */
export function init(opts: { wasmPath: string }) {
  _wasmBasePath = opts.wasmPath.endsWith('/') ? opts.wasmPath : opts.wasmPath + '/';
}

async function getEncModule() {
  if (!_encModule) {
    if (!_wasmBasePath) {
      throw new Error(
        '@freezedry/compress: call init({ wasmPath }) before encoding, ' +
        'or use @freezedry/compress/node for server-side usage with sharp',
      );
    }
    const { default: factory } = await import(/* webpackIgnore: true */ `${_wasmBasePath}avif_enc.js`);
    _encModule = initEmscriptenModule(factory) as Promise<any>;
  }
  return _encModule;
}

async function getDecModule() {
  if (!_decModule) {
    if (!_wasmBasePath) {
      throw new Error(
        '@freezedry/compress: call init({ wasmPath }) before decoding, ' +
        'or use @freezedry/compress/node for server-side usage with sharp',
      );
    }
    const { default: factory } = await import(/* webpackIgnore: true */ `${_wasmBasePath}avif_dec.js`);
    _decModule = initEmscriptenModule(factory) as Promise<any>;
  }
  return _decModule;
}

/**
 * Browser AVIF codec using @jsquash WASM
 */
export const browserCodec: AvifCodec = {
  async encode(imageData: PixelData, options: AvifEncodeOptions): Promise<ArrayBuffer> {
    const module = await getEncModule();
    const opts = { ...AVIF_DEFAULTS, ...options };
    const output = module.encode(imageData.data, imageData.width, imageData.height, opts);
    if (!output) throw new Error('AVIF encoding error');
    return output.buffer;
  },

  async decode(buffer: ArrayBuffer): Promise<PixelData> {
    const module = await getDecModule();
    const result = module.decode(buffer);
    if (!result) throw new Error('AVIF decoding error');
    return result as PixelData;
  },
};
