#!/bin/sh
# rig-sites.sh — the rig's only site discovery: which rig sites exist on the machine?
#
#   rig-sites.sh list [root ...]   <dir>|<name>|<up|down|?> per site
#   rig-sites.sh roots [root ...]  the roots that are scanned, one per line
#
# A site is a directory with a `rigfile`. The scan is stateless on purpose: a
# registry (record the site when rig runs there) would have listed only sites you
# have already run rig in, and whoever just cloned their first site is exactly the one
# who needs the list. The price is that the roots must be guessed.
#
# Roots, in order: RIG_SITES_DIR (colon-separated) if set, otherwise cwd and
# its parent. That covers both common cases: you stand in the sites folder
# (~/projects) or in a site next to the one you want. No path is
# built in: the docs use ~/Developer as the example, but the code never assumes it.
# The depth is one: sites sit next to each other, not nested.
#
# The status costs ONE docker call for the whole list (docker compose ls), not
# one per site. A list that takes seconds to draw is worse than no list.
# The match is on the compose file's path, not the project name: the name
# is normalized (rig_compose_project) and worktrees change it.

set -eu

q="${1:?usage: rig-sites.sh <list|roots> [root ...]}"
shift

# The roots, deduplicated and normalized. A root that does not exist is dropped
# silently; RIG_SITES_DIR may point to a machine you are not sitting at.
roots() {
  if [ $# -gt 0 ]; then
    printf '%s\n' "$@"
  elif [ -n "${RIG_SITES_DIR-}" ]; then
    printf '%s\n' "$RIG_SITES_DIR" | tr ':' '\n'
  else
    printf '%s\n' "$PWD"
    dirname "$PWD"
  fi
}

resolved_roots() {
  seen=""
  roots "$@" | while IFS= read -r r; do
    [ -n "$r" ] || continue
    [ -d "$r" ] || continue
    r="$(cd "$r" && pwd -P)"
    case "$r" in
      /) continue ;;   # the whole filesystem is never a sites folder
    esac
    case "$seen" in
      *"|$r|"*) continue ;;
    esac
    seen="$seen|$r|"
    printf '%s\n' "$r"
  done
}

if [ "$q" = roots ]; then
  resolved_roots "$@"
  exit 0
fi

[ "$q" = list ] || { echo "rig-sites.sh: unknown query '$q'" >&2; exit 1; }

# maxdepth 2 catches both <root>/rigfile and <root>/<site>/rigfile. Errors are
# discarded: a root can contain directories we may not read (/Users).
dirs="$(
  resolved_roots "$@" | while IFS= read -r r; do
    find "$r" -maxdepth 2 -name rigfile -type f 2>/dev/null
  done | sed 's:/rigfile$::' | sort -u
)"

[ -n "$dirs" ] || exit 0

# One call for the whole list. If docker is missing (or not running) the
# status becomes '?'; the list must work before Docker Desktop has started.
projects="$(docker compose ls --format json 2>/dev/null || true)"

printf '%s\n' "$dirs" | while IFS= read -r dir; do
  name="$(sed -nE 's/^[[:space:]]*RIG_SITE[[:space:]]*=[[:space:]]*"?([^"#]*)"?.*/\1/p' "$dir/rigfile" | head -1 | tr -d '[:space:]')"
  [ -n "$name" ] || name="$(basename "$dir")"
  if [ -z "$projects" ]; then
    status="?"
  else
    case "$projects" in
      *"\"ConfigFiles\":\"$dir/"*) status=up ;;
      *) status=down ;;
    esac
  fi
  printf '%s|%s|%s\n' "$dir" "$name" "$status"
done
