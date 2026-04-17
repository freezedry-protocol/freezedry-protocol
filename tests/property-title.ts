/**
 * L2 Property-based tests for the `padTitle` helper + title field invariants.
 *
 * These are PURE LOGIC tests — no Anchor, no local validator, no RPC. They
 * run in ~1 second vs ~5 minutes for the full anchor test suite, and can be
 * invoked standalone via:
 *
 *   npx mocha --require ts-node/register tests/property-title.ts
 *
 * The padTitle implementation below is a clone of tests/fd-pointer.ts. Keep
 * them in sync until the helper is extracted to a shared module in Phase 2
 * (partner API + node will need it too — shared canonical home TBD).
 *
 * Property tests prove behavior over 10,000+ random inputs rather than the
 * handful of fixed examples in L1. They catch edge cases humans don't think
 * of (weird unicode, zero-width joiners, surrogate pairs, variation selectors).
 */

import { expect } from "chai";
import * as fc from "fast-check";

// ── padTitle implementation (keep in sync with tests/fd-pointer.ts) ─────────

function padTitle(s: string): Buffer {
  const buf = Buffer.alloc(32, 0);
  if (!s) return buf;

  const encoder = new TextEncoder();
  let byteLen = 0;
  let truncated = "";

  for (const ch of s) {
    const chBytes = encoder.encode(ch);
    if (byteLen + chBytes.length > 32) break;
    truncated += ch;
    byteLen += chBytes.length;
  }

  Buffer.from(truncated, "utf8").copy(buf, 0);
  return buf;
}

// ── Helper: compute the logical trim length (position of first zero) ────────
function trimLen(buf: Buffer): number {
  const idx = buf.indexOf(0);
  return idx === -1 ? buf.length : idx;
}

// ── Helper: decode the trimmed prefix as UTF-8 ──────────────────────────────
function decodeTrimmed(buf: Buffer): string {
  return buf.slice(0, trimLen(buf)).toString("utf8");
}

// ── Helper: is the byte sequence valid UTF-8? ───────────────────────────────
function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

// ── Property tests ──────────────────────────────────────────────────────────

describe("padTitle properties (L2 fuzz)", () => {
  const NUM_RUNS = 1000; // per property; 10 properties × 1000 = 10,000 assertions

  it("P1: output is always exactly 32 bytes", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = padTitle(s);
        return result.length === 32;
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("P2: trimmed output is always valid UTF-8", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = padTitle(s);
        const trimmed = result.slice(0, trimLen(result));
        return isValidUtf8(trimmed);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("P3: trimmed output byte length never exceeds 32", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = padTitle(s);
        return trimLen(result) <= 32;
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("P4: padding bytes (after trim position) are all zero", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = padTitle(s);
        const len = trimLen(result);
        for (let i = len; i < 32; i++) {
          if (result[i] !== 0) return false;
        }
        return true;
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("P5: when input fits in 32 UTF-8 bytes, decoding roundtrips exactly", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const utf8Len = Buffer.byteLength(s, "utf8");
        // Property only holds for inputs that fit (and that don't contain
        // embedded null bytes, since our trim logic stops at first 0x00).
        fc.pre(utf8Len <= 32 && !s.includes("\0"));
        const result = padTitle(s);
        const decoded = decodeTrimmed(result);
        return decoded === s;
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("P6: decoded output is always a prefix of the input (as Unicode code points)", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        // Inputs with embedded nulls can't be tested this way because our
        // trim logic stops at first 0x00, which loses everything after.
        fc.pre(!s.includes("\0"));
        const result = padTitle(s);
        const decoded = decodeTrimmed(result);
        return s.startsWith(decoded);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("P7: empty input always produces 32 zeros", () => {
    const result = padTitle("");
    expect(Array.from(result)).to.deep.equal(Array(32).fill(0));
  });

  it("P8: multi-byte Unicode (emoji, CJK, RTL, variation selectors) never splits a code point", () => {
    // fc.string({ unit: 'grapheme' }) yields full-Unicode strings —
    // emoji, supplementary plane, combining marks, everything.
    const multibyte = fc.oneof(
      fc.string({ unit: "grapheme" }),
      fc.string({ unit: "grapheme-composite" }),
      fc.string()
    );
    fc.assert(
      fc.property(multibyte, (s) => {
        fc.pre(!s.includes("\0"));
        const result = padTitle(s);
        const trimmed = result.slice(0, trimLen(result));
        // The trimmed bytes MUST decode as valid UTF-8 for ANY input
        return isValidUtf8(trimmed);
      }),
      { numRuns: NUM_RUNS * 2 }  // 2000 runs for this critical property
    );
  });

  it("P9: idempotent — padTitle(decode(padTitle(s))) === padTitle(s) for fitting inputs", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        fc.pre(!s.includes("\0"));
        const once = padTitle(s);
        const decoded = decodeTrimmed(once);
        const twice = padTitle(decoded);
        return Buffer.compare(once, twice) === 0;
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("P10: monotonicity — truncated output byte length ≤ input UTF-8 byte length", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        fc.pre(!s.includes("\0"));
        const result = padTitle(s);
        const resultBytes = trimLen(result);
        const inputBytes = Buffer.byteLength(s, "utf8");
        return resultBytes <= inputBytes || inputBytes > 32;
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // ── Fixed regression cases (previously-broken inputs from round 1) ─────────

  describe("regression cases from L1 failures", () => {
    it("handles the '夕焼け❄️' emoji + CJK case that broke round 1", () => {
      const input = "夕焼け❄️";
      const result = padTitle(input);
      const trimmed = result.slice(0, trimLen(result));
      expect(isValidUtf8(trimmed)).to.equal(true, "valid UTF-8");
      expect(trimmed.toString("utf8")).to.equal(input, "roundtrips exactly");
    });

    it("handles 20x CJK truncation (60 bytes → 30 bytes = 10 chars)", () => {
      const input = "日".repeat(20);
      const result = padTitle(input);
      expect(trimLen(result)).to.equal(30, "10 chars × 3 bytes each");
      expect(decodeTrimmed(result)).to.equal("日".repeat(10));
    });

    it("handles variation selector U+FE0F at boundary (was the original padTitle bug trigger)", () => {
      // Snowflake + variation selector-16 (emoji presentation)
      const input = "❄️"; // U+2744 U+FE0F = 6 bytes
      const result = padTitle(input);
      expect(decodeTrimmed(result)).to.equal(input);
    });

    it("handles single 4-byte emoji (supplementary plane)", () => {
      const input = "🎨"; // U+1F3A8, 4 bytes UTF-8
      const result = padTitle(input);
      expect(decodeTrimmed(result)).to.equal(input);
    });

    it("8 × 4-byte emoji fills exactly 32 bytes (no padding)", () => {
      // 8 × 4 = 32 bytes — fits EXACTLY, no trailing zeros
      const input = "🎨".repeat(8);
      const result = padTitle(input);
      expect(trimLen(result)).to.equal(32, "all 8 emojis fit with no padding");
      expect(decodeTrimmed(result)).to.equal("🎨".repeat(8));
    });

    it("9 × 4-byte emoji truncates to 8 (9th overflows 32-byte budget)", () => {
      // 9 × 4 = 36 bytes > 32 → 9th emoji can't fit, truncate to 8
      const input = "🎨".repeat(9);
      const result = padTitle(input);
      expect(trimLen(result)).to.equal(32, "8 emojis × 4 bytes = 32, no trailing zeros");
      expect(decodeTrimmed(result)).to.equal("🎨".repeat(8));
    });

    it("mixed: 7 × 4-byte emoji + 1 × 3-byte CJK = 31 bytes (partial boundary)", () => {
      // 7 × 4 = 28 + 3 = 31 bytes, fits; byte 31 = 0 (padding)
      const input = "🎨".repeat(7) + "日";
      const result = padTitle(input);
      expect(trimLen(result)).to.equal(31, "fits with 1 byte of zero padding");
      expect(decodeTrimmed(result)).to.equal(input);
    });

    it("mixed: 7 × 4-byte emoji + 2 × 3-byte CJK = 34 bytes (1 CJK truncated)", () => {
      // 7 × 4 = 28, + 日 (3) = 31 fits, + 日 (3) = 34 overflows → keep 7 emoji + 1 CJK
      const input = "🎨".repeat(7) + "日日";
      const result = padTitle(input);
      expect(trimLen(result)).to.equal(31);
      expect(decodeTrimmed(result)).to.equal("🎨".repeat(7) + "日");
    });
  });
});
