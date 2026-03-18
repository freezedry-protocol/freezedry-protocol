declare module 'tweetnacl' {
  export const sign: {
    detached: {
      verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
    };
  };
}
