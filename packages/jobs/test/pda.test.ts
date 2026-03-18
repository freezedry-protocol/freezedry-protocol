import { expect } from 'chai';
import { PublicKey, Keypair } from '@solana/web3.js';
import { PROGRAM_ID, deriveConfigPDA, deriveJobPDA, deriveAttestationPDA, deriveReferrerPDA } from '../src/pda.js';

describe('@freezedry/jobs — pda', () => {
  describe('PROGRAM_ID', () => {
    it('is the mainnet Jobs program', () => {
      expect(PROGRAM_ID.toBase58()).to.equal('AmqBYKYCqpmKoFcgvripCQ3bJC2d8ygWWhcoHtmTvvzx');
    });
  });

  describe('deriveConfigPDA', () => {
    it('returns a valid PublicKey and bump', () => {
      const [pda, bump] = deriveConfigPDA();
      expect(pda).to.be.instanceOf(PublicKey);
      expect(bump).to.be.a('number');
      expect(bump).to.be.gte(0).and.lte(255);
    });

    it('is deterministic', () => {
      const [pda1] = deriveConfigPDA();
      const [pda2] = deriveConfigPDA();
      expect(pda1.toBase58()).to.equal(pda2.toBase58());
    });

    it('accepts custom program ID', () => {
      const customId = Keypair.generate().publicKey;
      const [pda1] = deriveConfigPDA();
      const [pda2] = deriveConfigPDA(customId);
      expect(pda1.toBase58()).to.not.equal(pda2.toBase58());
    });
  });

  describe('deriveJobPDA', () => {
    it('returns deterministic PDA for job ID', () => {
      const [pda1] = deriveJobPDA(1);
      const [pda2] = deriveJobPDA(1);
      expect(pda1.toBase58()).to.equal(pda2.toBase58());
    });

    it('different job IDs produce different PDAs', () => {
      const [pda1] = deriveJobPDA(1);
      const [pda2] = deriveJobPDA(2);
      expect(pda1.toBase58()).to.not.equal(pda2.toBase58());
    });

    it('accepts bigint job ID', () => {
      const [pda1] = deriveJobPDA(42n);
      const [pda2] = deriveJobPDA(42);
      expect(pda1.toBase58()).to.equal(pda2.toBase58());
    });

    it('handles large job IDs', () => {
      const [pda] = deriveJobPDA(BigInt('18446744073709551615')); // max u64
      expect(pda).to.be.instanceOf(PublicKey);
    });
  });

  describe('deriveAttestationPDA', () => {
    it('is deterministic for same job + reader', () => {
      const reader = Keypair.generate().publicKey;
      const [pda1] = deriveAttestationPDA(1, reader);
      const [pda2] = deriveAttestationPDA(1, reader);
      expect(pda1.toBase58()).to.equal(pda2.toBase58());
    });

    it('different readers produce different PDAs', () => {
      const r1 = Keypair.generate().publicKey;
      const r2 = Keypair.generate().publicKey;
      const [pda1] = deriveAttestationPDA(1, r1);
      const [pda2] = deriveAttestationPDA(1, r2);
      expect(pda1.toBase58()).to.not.equal(pda2.toBase58());
    });

    it('different job IDs produce different PDAs', () => {
      const reader = Keypair.generate().publicKey;
      const [pda1] = deriveAttestationPDA(1, reader);
      const [pda2] = deriveAttestationPDA(2, reader);
      expect(pda1.toBase58()).to.not.equal(pda2.toBase58());
    });
  });

  describe('deriveReferrerPDA', () => {
    it('is deterministic for same wallet', () => {
      const wallet = Keypair.generate().publicKey;
      const [pda1] = deriveReferrerPDA(wallet);
      const [pda2] = deriveReferrerPDA(wallet);
      expect(pda1.toBase58()).to.equal(pda2.toBase58());
    });

    it('different wallets produce different PDAs', () => {
      const w1 = Keypair.generate().publicKey;
      const w2 = Keypair.generate().publicKey;
      const [pda1] = deriveReferrerPDA(w1);
      const [pda2] = deriveReferrerPDA(w2);
      expect(pda1.toBase58()).to.not.equal(pda2.toBase58());
    });
  });
});
