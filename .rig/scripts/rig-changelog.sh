#!/usr/bin/env bash
set -euo pipefail

# rig-changelog.sh — reads and writes rig/CHANGELOG.md, the rig's changelog
# for the SITES (what a rig-update means), not its internal history.
# The file ships with the payload and ends up in the site as .rig/CHANGELOG.md, so
# it can be read without network or GitHub access, by a developer or an
# agent, and its diff is part of the update commit.
#
# Format (docs/decisions/2026-08-30-changelog.md):
#
#   ## Unreleased                  ← on top; every PR that changes something a site
#   ### Added | Changed | Action required   notices adds a line here
#   - one line per change
#   ## 2.1.0 — 2026-09-04          ← written by rig-release (candidate) from Unreleased
#
#   section <file> <version>          the section's body (without heading); the release
#                                     notes at promote
#   between <file> <from> <to>        the sections newer than <from> up to and including
#                                     <to>, with headings; rig-update/rig-status
#                                     print them. Empty <from> = everything up to <to>.
#   release <file> <version> <date>   rename Unreleased to the version and add
#                                     an empty Unreleased on top; fails if there is
#                                     nothing to release
#   check <file>                      format check (the test suite runs it)
#
# Versions in the headings are always final (X.Y.Z): an rc is pinned as
# 2.1.0-rc.1 but reads the section 2.1.0; the caller strips -rc.N.

die() { echo "❌ rig-changelog: $*" >&2; exit 1; }

cl_section() {   # cl_section <file> <version>
  awk -v v="$2" '
    /^## / { if (on) exit; on = ($2 == v); next }
    on { print }
  ' "$1" | cl_trim
}

cl_between() {   # cl_between <file> <from> <to>
  awk -v from="$2" -v to="$3" '
    /^## / {
      if (on && ($2 == from || stop_next)) exit
      if ($2 == to) { on = 1; if (from == to) stop_next = 1 }
    }
    on { print }
  ' "$1" | cl_trim
}

# Remove leading and trailing blank lines (awk: buffer blank lines, print them
# only when a non-empty line follows).
cl_trim() {
  awk '
    NF == 0 { if (started) blank++; next }
    { if (!started) started = 1; else while (blank > 0) { print ""; blank-- } ; blank = 0; print }
  '
}

cl_has_entries() {   # cl_has_entries <text> — at least one bullet line
  printf '%s\n' "$1" | grep -q '^- '
}

cl_release() {   # cl_release <file> <version> <date>
  local f="$1" v="$2" d="$3" unreleased existing
  echo "$v" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "version must be X.Y.Z (got '$v')"
  grep -q '^## Unreleased' "$f" || die "$f has no '## Unreleased' section"
  unreleased="$(cl_section "$f" Unreleased)"
  existing="$(cl_section "$f" "$v")"
  if grep -Eq "^## $v( |\$)" "$f"; then
    if cl_has_entries "$unreleased"; then
      die "both '## $v' and a filled '## Unreleased' exist — move the lines under ## $v by hand (new rc on the same version)"
    fi
    cl_has_entries "$existing" || die "'## $v' is empty — a release without a changelog is not shipped"
    echo "## $v already exists in $f — nothing to rename"
    return 0
  fi
  cl_has_entries "$unreleased" || die "'## Unreleased' in $f is empty — a release without a changelog is not shipped; write what $v means for the sites"
  awk -v v="$v" -v d="$d" '
    /^## Unreleased/ && !done { print "## Unreleased"; print ""; print "## " v " — " d; done = 1; next }
    { print }
  ' "$f" > "$f.tmp"
  mv "$f.tmp" "$f"
  echo "## Unreleased → ## $v — $d in $f"
}

cl_check() {   # cl_check <file>
  local f="$1" fail=0 first
  [ -f "$f" ] || die "$f does not exist"
  first="$(grep '^## ' "$f" | head -1)"
  [ "$first" = "## Unreleased" ] || { echo "❌ the first section must be '## Unreleased' (is '$first')"; fail=1; }
  grep '^## ' "$f" | grep -v '^## Unreleased$' | grep -vE '^## [0-9]+\.[0-9]+\.[0-9]+ — [0-9]{4}-[0-9]{2}-[0-9]{2}$' \
    | sed 's/^/❌ heading outside the format "## X.Y.Z — YYYY-MM-DD": /' | grep . && fail=1
  grep '^### ' "$f" | grep -vE '^### (Added|Changed|Action required)$' \
    | sed 's/^/❌ subheading outside Added|Changed|Action required: /' | grep . && fail=1
  [ "$(grep -c '^## Unreleased$' "$f")" = 1 ] || { echo "❌ exactly one '## Unreleased'"; fail=1; }
  [ "$fail" = 0 ] || exit 1
  echo "✅ $f: $(grep -cE '^## [0-9]' "$f") released versions, the format holds"
}

case "${1:-}" in
  section) [ $# -eq 3 ] || die "usage: section <file> <version>";        cl_section "$2" "$3" ;;
  between) [ $# -eq 4 ] || die "usage: between <file> <from> <to>";      cl_between "$2" "$3" "$4" ;;
  release) [ $# -eq 4 ] || die "usage: release <file> <version> <date>"; cl_release "$2" "$3" "$4" ;;
  check)   [ $# -eq 2 ] || die "usage: check <file>";                    cl_check "$2" ;;
  *) die "usage: rig-changelog.sh {section|between|release|check} ..." ;;
esac
