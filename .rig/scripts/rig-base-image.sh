#!/usr/bin/env bash
set -euo pipefail

# rig-base-image.sh <runtime dir> <registry> — print the prebuilt
# base image's full reference for a runtime, or nothing if the runtime
# does not take part (the Dockerfile has no ARG RIG_BASE_IMAGE) or the registry is
# empty (disabled).
#
#   rig-base-image.sh .rig/plugins/wordpress/docker/cms ghcr.io/aventyret
#   → ghcr.io/aventyret/rig-base-wordpress-cms:sha-<12 chars>
#
# The tag is the content hash of the WHOLE runtime directory. The base stage copies
# config files (nginx.conf, php.ini, init.sh ...), so the Dockerfile alone
# is not enough as a key. The same script is used by the sites' ci.mk (vendored
# directory) and by aventyret-rig's publish workflow (the repo directory). The
# content is identical after rig-update, so the references match by
# construction: every content version that has existed on main is published.

dir="${1:-}"
registry="${2:-}"

[ -n "$dir" ] || { echo "usage: rig-base-image.sh <runtime dir> <registry>" >&2; exit 1; }
[ -n "$registry" ] || exit 0
[ -f "$dir/Dockerfile" ] || exit 0
grep -q '^ARG RIG_BASE_IMAGE' "$dir/Dockerfile" || exit 0

# shasum (perl) exists on both macOS and GitHub runners; sha256sum as fallback.
sha() {
  if command -v shasum >/dev/null; then shasum -a 256 "$@"; else sha256sum "$@"; fi
}

hash="$(
  cd "$dir" && find . -type f ! -name .DS_Store -print0 | LC_ALL=C sort -z \
    | while IFS= read -r -d '' f; do sha "$f"; done \
    | sha | cut -c1-12
)"
[ -n "$hash" ] || { echo "rig-base-image: could not hash $dir" >&2; exit 1; }

svc="$(basename "$dir")"
fw="$(basename "$(dirname "$(dirname "$dir")")")"

printf '%s/rig-base-%s-%s:sha-%s\n' "$registry" "$fw" "$svc" "$hash"
