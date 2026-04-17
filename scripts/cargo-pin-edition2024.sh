#!/usr/bin/env bash
# scripts/cargo-pin-edition2024.sh
#
# Pin transitive crates that have released edition2024-requiring versions.
# Solana platform-tools v1.48 (used by CLI 2.1.x and 2.2.x) bundles cargo 1.84
# which does NOT support edition = "2024". Newer versions of the crates below
# require that feature and break `cargo-build-sbf` / `solana-verify build`.
#
# Source: ~/.claude/skills/solana-dev/references/common-errors.md § edition2024.
# Updated 2026-01-31. Add crates here as platform-tools lags behind upstream.
#
# Usage:
#   bash scripts/cargo-pin-edition2024.sh
#   git add -f Cargo.lock
#   # then proceed with `solana-verify build --library-name fd_pointer`

set -euo pipefail
cd "$(dirname "$0")/.."

echo "[pin] ensuring Cargo.lock exists..."
# Only generate if missing — `cargo generate-lockfile` re-resolves from scratch
# and WILL undo prior pins. If the file exists, trust it and apply pins on top.
if [ ! -f Cargo.lock ]; then
  cargo generate-lockfile
fi

# Known problematic crates → safe versions (keep these in sync with solana-dev skill).
# proc-macro-crate 3.5.0 pulls toml_edit 0.25 which depends on toml_parser@1.1.2 (edition2024).
# Downgrading proc-macro-crate to 3.3.0 resolves back to toml_edit 0.22 — no toml_parser needed.
pins=(
  "blake3@1.8.2"
  "constant_time_eq@0.3.1"
  "base64ct@1.7.3"
  "indexmap@2.11.4"
  "proc-macro-crate@3.3.0"
  # unicode-segmentation@1.13.2 requires rustc 1.85 — Solana Docker ships 1.79
  "unicode-segmentation@1.12.0"
)

for pin in "${pins[@]}"; do
  crate="${pin%@*}"
  version="${pin#*@}"

  # Try the simple case first: cargo update -p <crate> --precise <version>.
  # Works when the crate appears exactly once in the dep graph.
  if cargo update -p "$crate" --precise "$version" 2>/dev/null; then
    echo "[pin] $crate → $version"
    continue
  fi

  # Ambiguous case: the crate appears under multiple versions in Cargo.lock
  # (e.g., proc-macro-crate 0.1.5 legacy AND proc-macro-crate 3.5.0 new).
  # Find ALL versions present, and try to pin each individually using the
  # unambiguous `<crate>@<exact_version>` selector. We only DOWNGRADE: if an
  # existing version is <= target, leave it alone. Newer than target gets
  # pulled back.
  # Collect unique versions of this crate from the lockfile
  found_versions=$(
    awk -v c="$crate" '
      /^\[\[package\]\]/ { in_pkg = 1; name = ""; version = "" }
      in_pkg && $0 ~ /^name = / { gsub(/"/, "", $3); name = $3 }
      in_pkg && $0 ~ /^version = / { gsub(/"/, "", $3); version = $3 }
      in_pkg && $0 == "" {
        if (name == c) print version
        in_pkg = 0
      }
      END {
        if (in_pkg && name == c) print version
      }
    ' Cargo.lock | sort -u
  )

  if [ -z "$found_versions" ]; then
    echo "[pin] $crate not in dep graph — skipped"
    continue
  fi

  pinned=0
  for cur in $found_versions; do
    if [ "$cur" = "$version" ]; then continue; fi
    # Only attempt downgrade if cur > version (semver-ish string compare works
    # for simple X.Y.Z versions; good enough for this use case).
    if printf '%s\n%s\n' "$cur" "$version" | sort -V | head -1 | grep -qx "$version"; then
      # cur > version → downgrade
      if cargo update -p "$crate@$cur" --precise "$version" 2>/dev/null; then
        echo "[pin] $crate@$cur → $version"
        pinned=1
      fi
    fi
  done

  if [ "$pinned" -eq 0 ]; then
    echo "[pin] $crate — no newer versions to pin (found: $(echo $found_versions | tr '\n' ' '))"
  fi
done

echo "[pin] done. Commit Cargo.lock and rebuild."
