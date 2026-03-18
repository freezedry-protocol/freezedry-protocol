import { expect } from 'chai';
import { extractPreview } from '../src/preview.js';

// Build a minimal open-mode .hyd blob with fake AVIF data
function makeOpenBlob(avifBytes: Uint8Array): Uint8Array {
  const HEADER_SIZE = 49;
  const delta = new Uint8Array(0); // no delta
  const blob = new Uint8Array(HEADER_SIZE + avifBytes.byteLength + delta.byteLength);
  const view = new DataView(blob.buffer);

  // Magic: HYD\x01
  blob[0] = 0x48; blob[1] = 0x59; blob[2] = 0x44; blob[3] = 0x01;
  blob[4] = 0; // open mode
  view.setUint16(5, 100, true);  // width
  view.setUint16(7, 100, true);  // height
  view.setUint32(9, avifBytes.byteLength, true);  // AVIF length
  view.setUint32(13, 0, true);  // delta length
  blob.set(new Uint8Array(32).fill(0xAA), 17); // hash
  blob.set(avifBytes, HEADER_SIZE);

  return blob;
}

describe('@freezedry/mint — extractPreview', () => {
  it('extracts AVIF bytes from open-mode blob', () => {
    const avifData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const blob = makeOpenBlob(avifData);

    const preview = extractPreview(blob);
    expect(preview).to.not.be.null;
    expect(preview).to.deep.equal(avifData);
  });

  it('returns null for encrypted blob (mode=1)', () => {
    const blob = makeOpenBlob(new Uint8Array([1, 2, 3]));
    blob[4] = 1; // coded mode
    expect(extractPreview(blob)).to.be.null;
  });

  it('returns null for proprietary blob (mode=2)', () => {
    const blob = makeOpenBlob(new Uint8Array([1, 2, 3]));
    blob[4] = 2; // proprietary mode
    expect(extractPreview(blob)).to.be.null;
  });

  it('returns null for blob too small', () => {
    const tiny = new Uint8Array(10);
    expect(extractPreview(tiny)).to.be.null;
  });

  it('returns null if AVIF length exceeds blob size', () => {
    const blob = makeOpenBlob(new Uint8Array([1, 2, 3]));
    // Corrupt AVIF length to be huge
    const view = new DataView(blob.buffer);
    view.setUint32(9, 999999, true);
    expect(extractPreview(blob)).to.be.null;
  });

  it('handles zero-length AVIF', () => {
    const blob = makeOpenBlob(new Uint8Array(0));
    const preview = extractPreview(blob);
    expect(preview).to.not.be.null;
    expect(preview!.byteLength).to.equal(0);
  });

  it('extracts only AVIF bytes, not delta', () => {
    const HEADER_SIZE = 49;
    const avif = new Uint8Array([10, 20, 30]);
    const delta = new Uint8Array([99, 98, 97, 96, 95]);

    const blob = new Uint8Array(HEADER_SIZE + avif.byteLength + delta.byteLength);
    const view = new DataView(blob.buffer);
    blob[0] = 0x48; blob[1] = 0x59; blob[2] = 0x44; blob[3] = 0x01;
    blob[4] = 0;
    view.setUint16(5, 10, true);
    view.setUint16(7, 10, true);
    view.setUint32(9, avif.byteLength, true);
    view.setUint32(13, delta.byteLength, true);
    blob.set(new Uint8Array(32), 17);
    blob.set(avif, HEADER_SIZE);
    blob.set(delta, HEADER_SIZE + avif.byteLength);

    const preview = extractPreview(blob);
    expect(preview).to.deep.equal(avif);
    expect(preview!.byteLength).to.equal(3); // only AVIF, not delta
  });
});
