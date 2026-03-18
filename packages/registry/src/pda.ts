import { PublicKey } from "@solana/web3.js";

/** Default program ID — update after mainnet deploy */
export const PROGRAM_ID = new PublicKey(
  "6UGJUc28AuCj8a8sjhsVEKbvYHfQECCuJC7i54vk2to"
);

/** PDA seed prefix */
const SEED_PREFIX = Buffer.from("freeze-node");

/**
 * Derive the node PDA for a given wallet.
 * Seeds: ["freeze-node", owner_pubkey]
 */
export function deriveNodePDA(
  owner: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_PREFIX, owner.toBuffer()],
    programId
  );
}
