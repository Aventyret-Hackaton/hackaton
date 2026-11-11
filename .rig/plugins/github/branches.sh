#!/usr/bin/env bash
set -euo pipefail

# branches.sh — apply the rig's branch model to the site repo
# (docs/BRANCH_STRATEGY.md): main is the only long-lived branch, everything goes via
# PR, squash merge, requires the check "pr / build", no force push/deletion.
# Per repo but scripted and convergent (org rulesets require GitHub Enterprise).
# Idempotent via gh api. Run from the site repo's root:
#
#   rig github-branches           → apply (default branch main, ruleset
#                                    from plugins/github/rulesets/main.json)
#   rig github-branches CHECK=1   → report drift without changing anything
#
# NOTE: the required check comes from the PR workflow. Apply AFTER the
# stubs exist in the repo and a PR run has reported, otherwise no PRs can
# be merged until the first run.
#
# Sites from the develop/main model: the ruleset `rig-develop` is removed here;
# the branch `develop` is left (delete it by hand once it is merged).

CHECK="${CHECK:-0}"

log() { echo "⚙️  github-branches: $*"; }
die() { echo "❌ $*" >&2; exit 1; }
drift() { DRIFT=1; echo "⚠️  $*"; }
DRIFT=0

command -v gh >/dev/null || die "gh is missing — brew install gh && gh auth login"
gh auth status >/dev/null 2>&1 || die "gh is not logged in — gh auth login"

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" \
  || die "no GitHub remote here — run from the site repo's root"
log "repo: $REPO"

RULESET_DIR="$(cd "$(dirname "$0")" && pwd)/rulesets"
[ -d "$RULESET_DIR" ] || die "cannot find the ruleset specs ($RULESET_DIR) — run 'rig self update'"

##############################################################################
## 1. main is the default branch

DEFAULT_BRANCH="$(gh api "repos/$REPO" --jq .default_branch)"
if [ "$DEFAULT_BRANCH" != "main" ]; then
  if [ "$CHECK" = "1" ]; then
    drift "default branch is $DEFAULT_BRANCH (should be main)"
  else
    gh api "repos/$REPO/git/ref/heads/main" >/dev/null 2>&1 \
      || die "the branch main does not exist in $REPO — create it first"
    gh api -X PATCH "repos/$REPO" -f default_branch=main >/dev/null
    log "✅ default branch: $DEFAULT_BRANCH → main"
  fi
else
  log "default branch is main"
fi

if gh api "repos/$REPO/git/ref/heads/develop" >/dev/null 2>&1; then
  log "ℹ️  the branch develop still exists — the model has no develop; delete it when everything is merged to main"
fi

##############################################################################
## 2. rulesets: the specs are created/updated by name, old rig rulesets are removed

EXISTING="$(gh api "repos/$REPO/rulesets" --jq '[.[] | {id, name}]')"

for spec in "$RULESET_DIR"/*.json; do
  name="$(jq -r .name "$spec")"
  id="$(echo "$EXISTING" | jq -r --arg n "$name" '.[] | select(.name == $n) | .id')"
  if [ "$CHECK" = "1" ]; then
    if [ -z "$id" ]; then
      drift "ruleset '$name' is missing"
    else
      live="$(gh api "repos/$REPO/rulesets/$id" \
        | jq -S '{name, target, enforcement, conditions, rules: (.rules | sort_by(.type))}')"
      want="$(jq -S '{name, target, enforcement, conditions, rules: (.rules | sort_by(.type))}' "$spec")"
      if [ "$live" = "$want" ]; then
        log "ruleset '$name' in sync"
      else
        drift "ruleset '$name' deviates from the spec (diff: gh api repos/$REPO/rulesets/$id)"
      fi
    fi
  else
    if [ -z "$id" ]; then
      gh api -X POST "repos/$REPO/rulesets" --input "$spec" >/dev/null
      log "✅ ruleset '$name' created"
    else
      gh api -X PUT "repos/$REPO/rulesets/$id" --input "$spec" >/dev/null
      log "✅ ruleset '$name' updated"
    fi
  fi
done

# Convergent: rig rulesets that no longer have a spec (rig-develop).
for id in $(echo "$EXISTING" | jq -r '.[] | select(.name | startswith("rig-")) | .id'); do
  name="$(echo "$EXISTING" | jq -r --argjson i "$id" '.[] | select(.id == $i) | .name')"
  [ -f "$RULESET_DIR/${name#rig-}.json" ] && continue
  if [ "$CHECK" = "1" ]; then
    drift "ruleset '$name' no longer has a spec (should be removed)"
  else
    gh api -X DELETE "repos/$REPO/rulesets/$id" >/dev/null
    log "🧹 ruleset '$name' removed (not in the model)"
  fi
done

if [ "$CHECK" = "1" ]; then
  if [ "$DRIFT" = "1" ]; then
    die "drift detected — run 'rig github-branches' to converge"
  fi
  log "✅ no drift"
else
  log "✅ done — the branch model is applied to $REPO"
fi
