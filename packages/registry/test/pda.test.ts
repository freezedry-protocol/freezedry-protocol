import { expect } from 'chai';
import { PublicKey, Keypair } from '@solana/web3.js';
import { PROGRAM_ID, deriveNodePDA } from '../src/pda.js';

describe('@freezedry/registry — pda', () => {
  describe('PROGRAM_ID', () => {
    it('is the mainnet Registry program', () => {
      expect(PROGRAM_ID.toBase58()).to.equal('6UGJUc28AuCj8a8sjhsVEKbvYHfQECCuJC7i54vk2to');
    });
  });

  describe('deriveNodePDA', () => {
    it('returns a valid PublicKey and bump', () => {
      const owner = Keypair.generate().publicKey;
      const [pda, bump] = deriveNodePDA(owner);
      expect(pda).to.be.instanceOf(PublicKey);
      expect(bump).to.be.a('number');
      expect(bump).to.be.gte(0).and.lte(255);
    });

    it('is deterministic', () => {
      const owner = Keypair.generate().publicKey;
      const [pda1] = deriveNodePDA(owner);
      const [pda2] = deriveNodePDA(owner);
      expect(pda1.toBase58()).to.equal(pda2.toBase58());
    });

    it('different owners produce different PDAs', () => {
      const o1 = Keypair.generate().publicKey;
      const o2 = Keypair.generate().publicKey;
      const [pda1] = deriveNodePDA(o1);
      const [pda2] = deriveNodePDA(o2);
      expect(pda1.toBase58()).to.not.equal(pda2.toBase58());
    });

    it('accepts custom program ID', () => {
      const owner = Keypair.generate().publicKey;
      const customId = Keypair.generate().publicKey;
      const [pda1] = deriveNodePDA(owner);
      const [pda2] = deriveNodePDA(owner, customId);
      expect(pda1.toBase58()).to.not.equal(pda2.toBase58());
    });
  });
});
