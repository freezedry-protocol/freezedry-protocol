import { expect } from 'chai';
import { PublicKey, Keypair } from '@solana/web3.js';
import { buildMemoTxs, buildPointerMemo, MEMO_PROGRAM_ID } from '../src/inscribe.js';
import { shred, uint8ToBase64 } from '../src/shred.js';

describe('@freezedry/solana — inscribe', () => {
  const payer = Keypair.generate().publicKey;
  const blockhash = '11111111111111111111111111111111';

  describe('MEMO_PROGRAM_ID', () => {
    it('is the Solana Memo Program v2', () => {
      expect(MEMO_PROGRAM_ID.toBase58()).to.equal('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    });
  });

  describe('buildMemoTxs', () => {
    it('builds one TX per chunk', () => {
      const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
      const txs = buildMemoTxs(chunks, { payer, blockhash });
      expect(txs).to.have.lengthOf(2);
    });

    it('each TX has 2 instructions (compute budget + memo)', () => {
      const chunks = [new Uint8Array([1, 2, 3])];
      const txs = buildMemoTxs(chunks, { payer, blockhash });
      expect(txs[0].instructions).to.have.lengthOf(2);
    });

    it('memo instruction uses MEMO_PROGRAM_ID', () => {
      const chunks = [new Uint8Array([10, 20, 30])];
      const txs = buildMemoTxs(chunks, { payer, blockhash });
      const memoIx = txs[0].instructions[1];
      expect(memoIx.programId.toBase58()).to.equal(MEMO_PROGRAM_ID.toBase58());
    });

    it('payer is signer on memo instruction', () => {
      const chunks = [new Uint8Array([1])];
      const txs = buildMemoTxs(chunks, { payer, blockhash });
      const memoIx = txs[0].instructions[1];
      expect(memoIx.keys[0].pubkey.toBase58()).to.equal(payer.toBase58());
      expect(memoIx.keys[0].isSigner).to.be.true;
    });

    it('without hash8 — memo is raw base64', () => {
      const chunk = new Uint8Array([65, 66, 67]); // "ABC"
      const txs = buildMemoTxs([chunk], { payer, blockhash });
      const memoData = txs[0].instructions[1].data.toString('utf8');
      expect(memoData).to.equal(uint8ToBase64(chunk));
      expect(memoData).to.not.include('FD:');
    });

    it('with hash8 — memo has v3 header FD:{hash8}:{idx}:{data}', () => {
      const chunk = new Uint8Array([65, 66, 67]);
      const txs = buildMemoTxs([chunk], { payer, blockhash, hash8: 'abcd1234' });
      const memoData = txs[0].instructions[1].data.toString('utf8');
      expect(memoData).to.match(/^FD:abcd1234:00:/);
    });

    it('v3 header index is zero-padded', () => {
      const chunks = Array.from({ length: 3 }, () => new Uint8Array([1]));
      const txs = buildMemoTxs(chunks, { payer, blockhash, hash8: 'abcd1234' });
      const memo0 = txs[0].instructions[1].data.toString('utf8');
      const memo2 = txs[2].instructions[1].data.toString('utf8');
      expect(memo0).to.include(':00:');
      expect(memo2).to.include(':02:');
    });

    it('sets feePayer on transaction', () => {
      const chunks = [new Uint8Array([1])];
      const txs = buildMemoTxs(chunks, { payer, blockhash });
      expect(txs[0].feePayer!.toBase58()).to.equal(payer.toBase58());
    });

    it('sets recentBlockhash on transaction', () => {
      const chunks = [new Uint8Array([1])];
      const txs = buildMemoTxs(chunks, { payer, blockhash });
      expect(txs[0].recentBlockhash).to.equal(blockhash);
    });

    it('round-trips with shred — chunk data preserved in memo', () => {
      const blob = new Uint8Array([10, 20, 30, 40, 50]);
      const chunks = shred(blob);
      const txs = buildMemoTxs(chunks, { payer, blockhash });
      const memoData = txs[0].instructions[1].data.toString('utf8');
      expect(memoData).to.equal(uint8ToBase64(blob));
    });
  });

  describe('buildPointerMemo', () => {
    it('builds FREEZEDRY:3 format pointer', () => {
      const tx = buildPointerMemo('sha256:abc123', 85, { payer, blockhash });
      const memoIx = tx.instructions[2]; // CU limit + CU price + memo
      const memoData = memoIx.data.toString('utf8');
      expect(memoData).to.match(/^FREEZEDRY:3:sha256:abc123:85:/);
    });

    it('has 3 instructions (CU limit + CU price + memo)', () => {
      const tx = buildPointerMemo('sha256:abc', 10, { payer, blockhash });
      expect(tx.instructions).to.have.lengthOf(3);
    });

    it('includes blobSize and chunkSize', () => {
      const tx = buildPointerMemo('sha256:abc', 10, {
        payer, blockhash,
        blobSize: 50000,
        chunkSize: 585,
      });
      const memo = tx.instructions[2].data.toString('utf8');
      expect(memo).to.include(':50000:585:');
    });

    it('includes flags and inscriber prefix', () => {
      const tx = buildPointerMemo('sha256:abc', 10, {
        payer, blockhash,
        flags: 'oIc',
      });
      const memo = tx.instructions[2].data.toString('utf8');
      expect(memo).to.include(':oIc:');
      // Inscriber is first 8 chars of payer base58
      expect(memo).to.include(`:${payer.toBase58().substring(0, 8)}:`);
    });

    it('includes lastChunkSig when provided', () => {
      const lastSig = '5abc123def456';
      const tx = buildPointerMemo('sha256:abc', 10, {
        payer, blockhash,
        lastChunkSig: lastSig,
      });
      const memo = tx.instructions[2].data.toString('utf8');
      expect(memo).to.include(lastSig);
    });

    it('sets feePayer correctly', () => {
      const tx = buildPointerMemo('sha256:abc', 10, { payer, blockhash });
      expect(tx.feePayer!.toBase58()).to.equal(payer.toBase58());
    });
  });
});
