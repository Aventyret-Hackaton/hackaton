# worktree — parallel runtime environments from git worktrees.
#
# `rig worktree <branch|pr>` creates a git worktree as a sibling directory
# (<repo>--<slug>), runs setup+up there and gives the environment its own identity:
# https://www.<site>-<slug>.test, its own compose project, its own volumes,
# in parallel with the main checkout's https://www.<site>.test.
#
# The database is the only expensive part of a new environment, and setup does not
# import the seed again: it clones the site's golden db volume (see the db plugin), which
# takes seconds instead of minutes. The volume is per site and survives
# worktree-rm. Only the project's own copy is torn down.
#
# Assumes that the site's compose interpolates ${RIG_HOST_BASE} in domains,
# router names and cert label, and that internal traffic goes over the project's own
# default network. The derivation of the host base lives in core (rig_host_base).
#
# A multisite site with its own literal brand hosts (not derived from
# RIG_HOST_BASE, to mirror the production domains) adds ${RIG_WORKTREE_SUFFIX}
# to each of them (rig_worktree_suffix, core). Otherwise those literals collide
# between the main environment and every worktree.

wt_require_main() {
  rig_in_git || die "not a git repo"
  if rig_is_linked_worktree; then
    die "run from the main checkout, not from a worktree"
  fi
}

# <branch|pr-number> → branch name. A purely numeric argument is looked up as a PR.
wt_resolve_branch() {
  local ref="${1:?give a branch or a PR number}"
  case "$ref" in
    '' | *[!0-9]*)
      printf '%s\n' "$ref"
      ;;
    *)
      command -v gh >/dev/null 2>&1 || die "PR #$ref requires gh (brew install gh)"
      gh pr view "$ref" --json headRefName -q .headRefName \
        || die "could not look up PR #$ref via gh"
      ;;
  esac
}

wt_dir_for() {
  printf '%s/%s--%s\n' "$(dirname "$PWD")" "$(basename "$PWD")" "$(rig_slugify "$1")"
}

doc worktree-add "Worktree + environment for a branch or a PR: rig worktree add <branch|pr>"
task::worktree-add() {
  wt_require_main
  local branch dir
  branch="$(wt_resolve_branch "${1-}")"
  dir="$(wt_dir_for "$branch")"
  if [ -d "$dir" ]; then
    log "worktree already exists: $dir — reusing it"
  else
    git fetch origin "$branch" >&2 2>/dev/null || true
    if git show-ref --verify --quiet "refs/heads/$branch"; then
      git worktree add "$dir" "$branch" >&2
    elif git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
      git worktree add --track -b "$branch" "$dir" "origin/$branch" >&2
    else
      die "the branch '$branch' exists neither locally nor on origin"
    fi
    log "worktree created: $dir ($branch)"
  fi
  "$RIG_BIN" -C "$dir" setup
  "$RIG_BIN" -C "$dir" up
  local base
  base="$(cd "$dir" && rig_host_base)"
  echo ""
  log "✅ the environment is up: https://www.$base.test"
  log "   (other domains follow the site's compose labels: cms.$base.test, ...)"
  log "   tear down with 'rig worktree rm $branch'"
}

doc worktree-list "List worktrees: directory, branch, domain, containers"
task::worktree-list() {
  rig_in_git || die "not a git repo"
  local path branch base proj running
  git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r path; do
    [ -d "$path" ] || continue
    base="$(cd "$path" && rig_host_base)"
    proj="$(cd "$path" && rig_compose_project)"
    branch="$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
    running="$(docker ps -q --filter "label=com.docker.compose.project=$proj" 2>/dev/null | wc -l | tr -d ' ')"
    printf '%-44s %-28s https://www.%s.test  (%s containers)\n' \
      "$path" "[$branch]" "$base" "$running"
  done
}

doc worktree-rm "Tear down the environment (down --volumes) + remove the worktree: rig worktree rm <branch|pr>"
task::worktree-rm() {
  wt_require_main
  local branch dir base
  branch="$(wt_resolve_branch "${1-}")"
  dir="$(wt_dir_for "$branch")"
  [ -d "$dir" ] || die "no worktree at $dir"
  # The host base must be read while the worktree exists. It is derived from git in cwd.
  base="$(cd "$dir" && rig_host_base)"
  log "tearing down the compose environment in $dir (down --volumes)"
  (cd "$dir" && docker compose down --volumes --remove-orphans >&2) \
    || log "⚠️  compose down failed — continuing with the worktree removal"
  git worktree remove "$dir" >&2 \
    || die "git worktree remove refused (uncommitted changes?) — commit/clean up in $dir, or remove it by hand with 'git worktree remove --force'"
  # The cert is machine state, not site state: it lives in the aventyret-rig
  # checkout and otherwise outlives every torn-down PR environment forever.
  task::proxy-cert-rm "$base" \
    || log "⚠️  could not clean up the cert for $base.test — run 'rig proxy cert-rm $base' by hand"
  log "✅ worktree removed: $dir"
}
