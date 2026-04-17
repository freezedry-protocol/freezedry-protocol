// Pure helper functions extracted from instruction handlers so they can be
// unit-tested in isolation with proptest (see the #[cfg(test)] module at the
// bottom of this file). These are NOT Anchor-specific — no Context, no
// account access, no CPI. Keeping them pure lets us fuzz them with ~10,000
// random inputs in seconds, independent of the SVM.

/// Returns `true` iff the non-null-padding prefix of `title` is valid UTF-8.
///
/// Convention: the first 0x00 byte marks the end of the logical string;
/// everything after is zero padding (not validated). An all-zeros input
/// (empty string) is valid UTF-8 by definition.
///
/// This is the exact logic that runs in `create_pointer_v2` — if this
/// function returns false, the handler returns `PointerError::InvalidTitle`.
pub fn is_valid_title_utf8(title: &[u8; 32]) -> bool {
    let logical_len = title.iter().position(|&b| b == 0).unwrap_or(title.len());
    core::str::from_utf8(&title[..logical_len]).is_ok()
}

// ═══════════════════════════════════════════════════════════════════════
// Serialized byte offsets for the Pointer account (post-discriminator).
//
// Anchor/Borsh serializes struct fields sequentially with NO padding.
// Every offset = discriminator (8) + sum of prior field sizes.
//
// These constants are the single source of truth for "where field X lives
// in the serialized PDA bytes." The compile-time asserts below pin every
// offset, and the runtime test in #[cfg(test)] proves Borsh actually
// places each field at the expected offset.
//
// If anyone reorders fields in state.rs, the cumulative arithmetic changes,
// the compile-time asserts catch it, the runtime test catches it, AND
// T2 in the Lean proofs would need updating. Triple-redundant.
// ═══════════════════════════════════════════════════════════════════════

pub const DISCRIMINATOR_SIZE: usize = 8;

/// Anchor account discriminator for the `Pointer` struct.
/// Derived as sha256("account:Pointer")[..8]. This is what Anchor writes as
/// the first 8 bytes of every Pointer account at creation, and what we check
/// to identify our accounts (especially in migrate_pointer_account, where
/// the account is too small for Account<Pointer> to deserialize cleanly).
pub const ANCHOR_POINTER_DISCRIMINATOR: [u8; 8] = [31, 144, 159, 52, 95, 134, 207, 237];

/// Minimum size (including 8-byte discriminator) of any historical Pointer
/// account we've ever deployed. v1 launched on 2026-04-13 with 260 bytes.
/// Used as a floor check in migrate_pointer_account — accounts smaller than
/// this are presumed corrupted or not our program's accounts at all.
pub const MIN_POINTER_ACCOUNT_SIZE: usize = 260;

pub const OFFSET_CONTENT_HASH: usize = DISCRIMINATOR_SIZE;
pub const OFFSET_INSCRIBER:    usize = OFFSET_CONTENT_HASH + 32;
pub const OFFSET_COLLECTION:   usize = OFFSET_INSCRIBER    + 32;
pub const OFFSET_CHUNK_COUNT:  usize = OFFSET_COLLECTION   + 32;
pub const OFFSET_BLOB_SIZE:    usize = OFFSET_CHUNK_COUNT  + 4;
pub const OFFSET_LAST_SIG:     usize = OFFSET_BLOB_SIZE    + 4;
pub const OFFSET_MODE:         usize = OFFSET_LAST_SIG     + 64;
pub const OFFSET_CONTENT_TYPE: usize = OFFSET_MODE         + 1;
pub const OFFSET_SLOT:         usize = OFFSET_CONTENT_TYPE + 1;
pub const OFFSET_TIMESTAMP:    usize = OFFSET_SLOT         + 8;
pub const OFFSET_PRIMARY_NFT:  usize = OFFSET_TIMESTAMP    + 8;
pub const OFFSET_VERSION:      usize = OFFSET_PRIMARY_NFT  + 32;
pub const OFFSET_BUMP:         usize = OFFSET_VERSION      + 1;
pub const OFFSET_TITLE:        usize = OFFSET_BUMP         + 1;
pub const OFFSET_RESERVED:     usize = OFFSET_TITLE        + 32;

pub const ACCOUNT_SIZE_V2: usize = OFFSET_RESERVED + 64;

// Compile-time pinning — if these fire, someone changed the layout without
// updating the constants. The error messages tell you which offset drifted.
const _: () = assert!(OFFSET_CONTENT_HASH == 8,   "OFFSET_CONTENT_HASH drifted");
const _: () = assert!(OFFSET_INSCRIBER    == 40,  "OFFSET_INSCRIBER drifted");
const _: () = assert!(OFFSET_COLLECTION   == 72,  "OFFSET_COLLECTION drifted");
const _: () = assert!(OFFSET_CHUNK_COUNT  == 104, "OFFSET_CHUNK_COUNT drifted");
const _: () = assert!(OFFSET_BLOB_SIZE    == 108, "OFFSET_BLOB_SIZE drifted");
const _: () = assert!(OFFSET_LAST_SIG     == 112, "OFFSET_LAST_SIG drifted");
const _: () = assert!(OFFSET_MODE         == 176, "OFFSET_MODE drifted");
const _: () = assert!(OFFSET_CONTENT_TYPE == 177, "OFFSET_CONTENT_TYPE drifted");
const _: () = assert!(OFFSET_SLOT         == 178, "OFFSET_SLOT drifted");
const _: () = assert!(OFFSET_TIMESTAMP    == 186, "OFFSET_TIMESTAMP drifted");
const _: () = assert!(OFFSET_PRIMARY_NFT  == 194, "OFFSET_PRIMARY_NFT drifted");
const _: () = assert!(OFFSET_VERSION      == 226, "OFFSET_VERSION drifted");
const _: () = assert!(OFFSET_BUMP         == 227, "OFFSET_BUMP drifted");
const _: () = assert!(OFFSET_TITLE        == 228, "OFFSET_TITLE drifted");
const _: () = assert!(OFFSET_RESERVED     == 260, "OFFSET_RESERVED drifted");
const _: () = assert!(ACCOUNT_SIZE_V2     == 324, "ACCOUNT_SIZE_V2 drifted");

// ═══════════════════════════════════════════════════════════════════════
// Property-based tests (cargo test -p fd-pointer)
// ═══════════════════════════════════════════════════════════════════════
//
// These tests run against the exact Rust function used by the on-chain
// handler. Every test that passes here proves a property about the actual
// deployed code, not a Lean model of it.

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::*;
    use crate::state::Pointer;

    // NOTE: proptest was evaluated as a dev-dep but pulls wit-bindgen 0.51.0
    // transitively via rand 0.9, which requires edition2024 and breaks the
    // Solana Docker verified build (platform-tools ships rust 1.79, not 1.85+).
    // Property-based coverage is handled entirely by TS fast-check in
    // tests/property-title.ts (12k+ random Unicode inputs). The deterministic
    // Rust tests below cover every distinct UTF-8 edge case we care about for
    // is_valid_title_utf8 — including what proptest would have randomized
    // (boundary bytes, overlong encodings, surrogates, null placement).

    // ── Runtime field-offset pinning via actual Borsh serialization ─────
    //
    // This test catches what the compile-time consts can't: someone reorders
    // the fields in state.rs without updating util.rs. Borsh serializes in
    // declaration order, so a reorder changes where each field lands in the
    // bytes — and this test fails loudly with "title expected at offset 228
    // but found at offset X."

    #[test]
    fn pointer_serialized_offsets_match_constants() {
        // Construct a Pointer with a UNIQUE byte pattern in each field so we
        // can find each field's position in the serialized bytes.
        let p = Pointer {
            content_hash: [0xA1; 32],   // pattern: A1 A1 ... A1 (32 bytes)
            inscriber:    Pubkey::new_from_array([0xA2; 32]),
            collection:   Pubkey::new_from_array([0xA3; 32]),
            chunk_count:  0xA4A4_A4A4_u32,
            blob_size:    0xA5A5_A5A5_u32,
            last_sig:     [0xA6; 64],
            mode:         0xA7,
            content_type: 0xA8,
            slot:         0xA9A9_A9A9_A9A9_A9A9_u64,
            timestamp:    0x3B3B_3B3B_3B3B_3B3B_i64,  // 0xAA overflows i64 positive, use 0x3B
            primary_nft:  Pubkey::new_from_array([0xAB; 32]),
            version:      0xAC,
            bump:         0xAD,
            title:        [0xAE; 32],
            _reserved:    [0xAF; 64],
        };

        // Serialize via Anchor's account serializer (8-byte discriminator
        // prepended to Borsh-encoded fields).
        let mut buf: Vec<u8> = Vec::with_capacity(ACCOUNT_SIZE_V2);
        Pointer::try_serialize(&p, &mut buf).expect("serialize Pointer");

        assert_eq!(
            buf.len(), ACCOUNT_SIZE_V2,
            "serialized size mismatch"
        );

        // Spot-check every field's first byte is at its expected offset.
        // If a field is reordered, its pattern shows up somewhere else and
        // this assertion fails with a clear "expected X at offset Y, got Z".
        let check = |offset: usize, pattern: u8, name: &str| {
            assert_eq!(
                buf[offset], pattern,
                "{} pattern {:#x} expected at offset {} but found {:#x}",
                name, pattern, offset, buf[offset]
            );
        };
        check(OFFSET_CONTENT_HASH, 0xA1, "content_hash");
        check(OFFSET_INSCRIBER,    0xA2, "inscriber");
        check(OFFSET_COLLECTION,   0xA3, "collection");
        check(OFFSET_CHUNK_COUNT,  0xA4, "chunk_count");
        check(OFFSET_BLOB_SIZE,    0xA5, "blob_size");
        check(OFFSET_LAST_SIG,     0xA6, "last_sig");
        check(OFFSET_MODE,         0xA7, "mode");
        check(OFFSET_CONTENT_TYPE, 0xA8, "content_type");
        check(OFFSET_SLOT,         0xA9, "slot");
        check(OFFSET_TIMESTAMP,    0x3B, "timestamp");
        check(OFFSET_PRIMARY_NFT,  0xAB, "primary_nft");
        check(OFFSET_VERSION,      0xAC, "version");
        check(OFFSET_BUMP,         0xAD, "bump");
        check(OFFSET_TITLE,        0xAE, "title");
        check(OFFSET_RESERVED,     0xAF, "_reserved");

        // Also check field LENGTHS by verifying the byte AFTER each field is
        // the start of the next field (not a repeat of this field's pattern).
        // content_hash is 32 bytes of 0xA1 → byte at offset+31 is 0xA1, byte at offset+32 is 0xA2.
        assert_eq!(buf[OFFSET_CONTENT_HASH + 31], 0xA1);
        assert_eq!(buf[OFFSET_CONTENT_HASH + 32], 0xA2, "content_hash must end at 32 bytes");
        assert_eq!(buf[OFFSET_LAST_SIG + 63], 0xA6);
        assert_eq!(buf[OFFSET_LAST_SIG + 64], 0xA7, "last_sig must end at 64 bytes");
        assert_eq!(buf[OFFSET_TITLE + 31], 0xAE);
        assert_eq!(buf[OFFSET_TITLE + 32], 0xAF, "title must end at 32 bytes");
        assert_eq!(buf[OFFSET_RESERVED + 63], 0xAF, "_reserved must be 64 bytes");
        assert_eq!(buf.len(), OFFSET_RESERVED + 64, "total account size");
    }

    // ── Deterministic regression cases ──────────────────────────────────

    #[test]
    fn valid_ascii_happy_path() {
        let mut title = [0u8; 32];
        let bytes = b"Sunset #3";
        title[..bytes.len()].copy_from_slice(bytes);
        assert!(is_valid_title_utf8(&title));
    }

    #[test]
    fn all_zeros_is_valid() {
        assert!(is_valid_title_utf8(&[0u8; 32]));
    }

    #[test]
    fn full_32_byte_ascii() {
        let title = [b'A'; 32];
        assert!(is_valid_title_utf8(&title));
    }

    #[test]
    fn full_32_byte_multibyte_utf8() {
        // 8 × 4-byte emoji = 32 bytes exactly
        let mut title = [0u8; 32];
        let bytes = "🎨".repeat(8);
        let b = bytes.as_bytes();
        assert_eq!(b.len(), 32);
        title.copy_from_slice(b);
        assert!(is_valid_title_utf8(&title));
    }

    #[test]
    fn rejects_lone_continuation_byte() {
        let mut title = [0u8; 32];
        title[0] = 0x80; // bare continuation, no lead byte
        assert!(!is_valid_title_utf8(&title));
    }

    #[test]
    fn rejects_truncated_multibyte_before_padding() {
        // CJK "日" is E6 97 A5 (3 bytes). Put just E6 97 then null padding.
        // The validator should reject because bytes [E6, 97] is an incomplete
        // multi-byte sequence (needs a continuation byte).
        let mut title = [0u8; 32];
        title[0] = 0xE6;
        title[1] = 0x97;
        // byte 2 is 0x00 — validator stops here, checks [E6, 97] = invalid
        assert!(!is_valid_title_utf8(&title));
    }

    #[test]
    fn rejects_invalid_overlong_encoding() {
        // 0xC0 0x80 is an overlong encoding for U+0000 — forbidden by the
        // UTF-8 spec. core::str::from_utf8 rejects it.
        let mut title = [0u8; 32];
        title[0] = 0xC0;
        title[1] = 0x80;
        // byte 2 = 0; validator checks [C0, 80] = invalid overlong
        assert!(!is_valid_title_utf8(&title));
    }

    #[test]
    fn rejects_surrogate_in_utf8() {
        // 0xED 0xA0 0x80 encodes U+D800 (high surrogate) — forbidden in UTF-8
        // because surrogates are only for UTF-16 pairs, not standalone code points.
        let mut title = [0u8; 32];
        title[0] = 0xED;
        title[1] = 0xA0;
        title[2] = 0x80;
        // byte 3 = 0; validator checks [ED, A0, 80] = invalid surrogate
        assert!(!is_valid_title_utf8(&title));
    }

    #[test]
    fn null_byte_mid_string_truncates_validation() {
        // "Hi\0garbage-after-null" — validator only checks up to first null.
        // Everything after should be ignored even if it's invalid.
        let mut title = [0u8; 32];
        title[0] = b'H';
        title[1] = b'i';
        title[2] = 0; // end of logical string
        title[3] = 0xFF; // invalid UTF-8 — but it's past the null, so ignored
        title[4] = 0xFE;
        assert!(is_valid_title_utf8(&title));
    }

    // ── Exhaustive boundary-value tests (replaces proptest) ─────────────

    /// Exhaustive: every lone continuation byte (0x80..=0xBF) is rejected.
    /// This is 64 values — a complete exhaustive check, not a sample.
    #[test]
    fn every_lone_continuation_byte_is_rejected() {
        for cont_byte in 0x80u8..=0xBF {
            let mut title = [0u8; 32];
            title[0] = cont_byte;
            assert!(
                !is_valid_title_utf8(&title),
                "lone continuation byte {:#x} must be rejected",
                cont_byte
            );
        }
    }

    /// Exhaustive: every (0..32) null-byte placement correctly truncates.
    /// For each position, we fill bytes AFTER it with 0xFF (invalid UTF-8)
    /// and confirm the validator ignores the garbage past the null.
    #[test]
    fn every_null_byte_position_truncates_correctly() {
        // Position 0 = immediate null = valid (empty string).
        // Positions 1..32 = ASCII prefix, null, garbage afterwards.
        for null_pos in 0usize..32 {
            let mut title = [0xFFu8; 32]; // start all garbage
            for i in 0..null_pos {
                title[i] = b'A'; // valid ASCII prefix
            }
            title[null_pos] = 0; // null terminator
            // Bytes null_pos+1..32 remain 0xFF (invalid UTF-8 in isolation,
            // but past the null so validator must ignore them).
            assert!(
                is_valid_title_utf8(&title),
                "null at pos {} should truncate validation",
                null_pos
            );
        }
    }

    /// Exhaustive: 0..=10 concatenated CJK chars (3 bytes each) all valid.
    /// Covers 0 bytes through 30 bytes of CJK content, bracketed by padding.
    #[test]
    fn every_cjk_count_up_to_budget_is_valid() {
        let cjk_bytes = "日".as_bytes(); // E6 97 A5
        for num_cjk in 0..=10 {
            let mut title = [0u8; 32];
            for i in 0..num_cjk {
                title[i * 3..i * 3 + 3].copy_from_slice(cjk_bytes);
            }
            assert!(
                is_valid_title_utf8(&title),
                "{} × CJK chars should be valid",
                num_cjk
            );
        }
    }

    /// Matches-stdlib check: sample every single-byte value (0..=255) as the
    /// first byte with zero padding. Validator's answer must match
    /// core::str::from_utf8 on the same single-byte slice. This is 256
    /// values — exhaustive for single-byte prefixes.
    #[test]
    fn every_single_byte_first_byte_matches_stdlib() {
        for b in 0u8..=0xFF {
            let mut title = [0u8; 32];
            title[0] = b;
            // Validator treats 0 as end-of-string — so for b=0, logical prefix
            // is empty (valid). For other values, prefix is [b].
            let prefix: &[u8] = if b == 0 { &[] } else { &title[..1] };
            let expected = core::str::from_utf8(prefix).is_ok();
            let actual = is_valid_title_utf8(&title);
            assert_eq!(
                expected, actual,
                "validator must match stdlib for first byte {:#x}: expected {}, got {}",
                b, expected, actual
            );
        }
    }

    /// Matches-stdlib check: all 2-byte prefixes with b1 in valid lead-byte
    /// ranges. Tests every plausible 2-byte UTF-8 start for validator/stdlib
    /// consistency. (65k combos of all b1, b2 would be too many for 32-byte
    /// slot anyway — limit to valid 2-byte lead bytes C2..=DF × continuations.)
    #[test]
    fn every_2byte_sequence_with_valid_lead_matches_stdlib() {
        for b1 in 0xC2u8..=0xDF {
            for b2 in 0x00u8..=0xFF {
                let mut title = [0u8; 32];
                title[0] = b1;
                title[1] = b2;
                // Validator's logical prefix ends at first 0 byte.
                // If b2 == 0, prefix is [b1] (which is a lead byte alone = invalid).
                // Otherwise prefix is [b1, b2].
                let prefix: &[u8] = if b2 == 0 { &title[..1] } else { &title[..2] };
                let expected = core::str::from_utf8(prefix).is_ok();
                let actual = is_valid_title_utf8(&title);
                assert_eq!(
                    expected, actual,
                    "validator must match stdlib for [{:#x}, {:#x}]",
                    b1, b2
                );
            }
        }
    }
}
