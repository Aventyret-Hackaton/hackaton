# rig-pin.sh — pinned version: interpret RIG_VERSION, fetch it into the cache,
# sync it into the site's .rig/. Sourced by the runner (bootstrap) and by rig.sh
# (setup/update); one implementation of "which rig does this site run".
#
# RIG_VERSION in rigfile is either
#   1.3.0 / 1.4.0-rc.1   a release tag (v1.3.0), immutable; fetched once
#                        to ~/.cache/aventyret-rig/versions/v1.3.0/ and
#                        reused by all sites on the machine
#   /absolute/path       a local aventyret-rig checkout, for developing
#                        the rig or testing a branch in a site
#
# .rig/ in the site is a COPY of <source>/rig (the payload), committed: the repo is
# self-sufficient. CI, Cloud Build or an Azure agent builds from a clean
# checkout without access to aventyret-rig. The copy is the rig's and is overwritten
# by `rig self update` (deviations live in the site: EXTRA_*, overlay, rigplugins/).
# .rig/PIN says which pin the copy comes from, so the runner can detect skew.

RIG_REPO_URL="${RIG_REPO:-https://github.com/Aventyret/aventyret-rig.git}"
RIG_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/aventyret-rig/versions"

# rig_pin_git <git arguments...> — git against RIG_REPO_URL without a prompt. If
# the remote is on https://github.com and gh exists, gh's token is borrowed via its
# credential helper: then `gh auth login` is enough, whether the user chose
# ssh or https as git protocol (ssh users have no https credential
# in git, and the clone died silently). The empty helper= resets any other helpers first.
rig_pin_git() {
  if case "$RIG_REPO_URL" in https://github.com/*) true ;; *) false ;; esac \
     && command -v gh >/dev/null 2>&1; then
    GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c 'credential.helper=!gh auth git-credential' "$@"
  else
    GIT_TERMINAL_PROMPT=0 git "$@"
  fi
}

# rig_pin_read <rigfile> → the value of RIG_VERSION (empty if the line is missing).
# Requires rig-decl.sh, which the runner and rig.sh source before this file.
rig_pin_read() { rig_decl_value "$1" RIG_VERSION; }

# rig_pin_kind <pin> → tag | path; status 1 if the form is unknown
rig_pin_kind() {
  case "$1" in
    /*) echo path ;;
    [0-9]*.[0-9]*.[0-9]*) echo tag ;;
    *) return 1 ;;
  esac
}

# rig_pin_source <pin> → the checkout/clone (the directory that has rig/ and
# compose.yaml), fetched into the cache if it is a tag that is missing there.
# Writes the error to stderr and returns 1 when the pin cannot be resolved.
rig_pin_source() {
  local pin="$1" kind dir
  kind="$(rig_pin_kind "$pin")" \
    || { printf '❌ RIG_VERSION=%s — must be a version (1.3.0, 1.4.0-rc.1) or an absolute path to an aventyret-rig checkout\n' "$pin" >&2; return 1; }
  if [ "$kind" = path ]; then
    dir="$pin"
    [ -d "$dir/rig/plugins" ] && [ -f "$dir/rig/bin/rig" ] \
      || { printf '❌ RIG_VERSION=%s — no aventyret-rig checkout there (missing rig/plugins and rig/bin/rig)\n' "$pin" >&2; return 1; }
    printf '%s\n' "$dir"
    return 0
  fi
  dir="$RIG_CACHE/v$pin"
  if [ ! -f "$dir/rig/bin/rig" ]; then
    rm -rf "$dir"
    mkdir -p "$RIG_CACHE"
    printf '⚙️  rig: fetching aventyret-rig v%s to %s\n' "$pin" "$dir" >&2
    if ! rig_pin_git clone --depth 1 --quiet --branch "v$pin" "$RIG_REPO_URL" "$dir" 2>/dev/null; then
      rm -rf "$dir"
      printf '❌ could not fetch v%s from %s — does the tag exist, and are you logged in (gh auth login, or gh auth setup-git if you use ssh)?\n' "$pin" "$RIG_REPO_URL" >&2
      return 1
    fi
    [ -f "$dir/rig/bin/rig" ] \
      || { rm -rf "$dir"; printf '❌ v%s is an older rig generation without rig/bin/rig — pin 2.0.0 or later\n' "$pin" >&2; return 1; }
  fi
  printf '%s\n' "$dir"
}

# rig_pin_drift <site dir> <source> → files in .rig/ that differ from
# the source (local changes that a sync overwrites). Empty = in sync.
rig_pin_drift() {
  [ -d "$1/.rig" ] || return 0
  diff -rq "$1/.rig" "$2/rig" 2>/dev/null \
    | sed -nE 's|^Files (.*) and .* differ$|\1|p; s|^Only in ('"$1"'/\.rig[^:]*): (.*)$|\1/\2|p' \
    | sed "s|^$1/||" \
    | grep -vE '^\.rig/(PIN|VERSION|MANIFEST)$' || true
}

# rig_pin_copy <site dir> <source> <pin> — sync <source>/rig → .rig/ (rsync
# --delete: the copy is the rig's and contains exactly the payload) and stamp
# .rig/PIN. A symlink .rig (the short-lived symlink model) is replaced with a copy.
# Content decides, not the timestamp (--checksum without -t): a file that is
# unchanged between the pins keeps its mtime, so the doctor's "the build context is
# newer than the image" (find -newer) only fires when the Dockerfile context actually
# changed, not after every update because the clone in the cache is fresh.
rig_pin_copy() {
  local site="$1" src="$2" pin="$3"
  if [ -L "$site/.rig" ]; then
    rm -f "$site/.rig"
  fi
  mkdir -p "$site/.rig"
  rsync -rlpgoD --checksum --delete --exclude '.git' "$src/rig/" "$site/.rig/"
  printf '%s\n' "$pin" > "$site/.rig/PIN"
}

# rig_pin_stamp <site dir> → the pin the copy comes from (empty = no stamp:
# a vendored copy from the v1 generation, or no .rig/ at all)
rig_pin_stamp() {
  [ -f "$1/.rig/PIN" ] || return 0
  head -1 "$1/.rig/PIN"
}

# rig_pin_latest → the latest final release (X.Y.Z) on the remote, empty if the network
# cannot be reached. One ls-remote, no clone.
rig_pin_latest() {
  rig_pin_git ls-remote --tags --refs "$RIG_REPO_URL" 'v*' 2>/dev/null \
    | sed 's|.*refs/tags/v||' \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -t. -k1,1n -k2,2n -k3,3n \
    | tail -1 || true
}

# rig_pin_newest <a> <b> → the higher of two final versions (equal → the same).
# The same sort as rig_pin_latest, so the comparison and the lookup agree.
rig_pin_newest() {
  printf '%s\n%s\n' "$1" "$2" \
    | sort -t. -k1,1n -k2,2n -k3,3n \
    | tail -1
}
