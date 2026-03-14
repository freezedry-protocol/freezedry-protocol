import { expect } from 'chai';
import { estimateCost } from '../src/cost.js';

describe('@freezedry/solana — cost', () => {
  describe('estimateCost', () => {
    it('returns correct chunk count', () => {
      const cost = estimateCost(600);  // exactly 1 chunk
      expect(cost.chunkCount).to.equal(1);

      const cost2 = estimateCost(601); // 2 chunks
      expect(cost2.chunkCount).to.equal(2);
    });

    it('calculates SOL cost from chunks * 5000 lamports', () => {
      const cost = estimateCost(600); // 1 chunk
      expect(cost.solCost).to.equal(5000 / 1_000_000_000);
    });

    it('calculates USD cost at default $180/SOL', () => {
      const cost = estimateCost(600);
      expect(cost.usdCost).to.equal(cost.solCost * 180);
    });

    it('accepts custom SOL price', () => {
      const cost = estimateCost(600, 200);
      expect(cost.usdCost).to.equal(cost.solCost * 200);
    });

    it('handles large blob (50KB = ~86 chunks)', () => {
      const cost = estimateCost(50000);
      expect(cost.chunkCount).to.equal(Math.ceil(50000 / 600));
      expect(cost.solCost).to.be.greaterThan(0);
      expect(cost.usdCost).to.be.greaterThan(0);
    });

    it('handles zero-size blob', () => {
      const cost = estimateCost(0);
      expect(cost.chunkCount).to.equal(0);
      expect(cost.solCost).to.equal(0);
      expect(cost.usdCost).to.equal(0);
    });
  });
});
