# github — the GitHub flow. Tasks that touch the repo's settings; vendoring of
# the workflow stubs lives in vendor.sh (run by rig.sh at setup/update), and
# the build contract the stubs call lives in plugin ci.

# "What runs where?" (docs/BRANCH_STRATEGY.md §7): deploys are registered by
# the workflows as GitHub Deployments with sha, image and digest in the payload.
# The table shows the latest successful deploy per environment and service, the starting point
# for the hotfix recipe (start from the release running in production).
doc deployments "What runs where: latest deploy per environment and service (GitHub Deployments)"
task::deployments() {
  command -v gh >/dev/null 2>&1 || die "gh is missing — brew install gh && gh auth login"
  local repo
  repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" \
    || die "no GitHub remote here — run from the site repo's root"
  gh api "repos/$repo/deployments?per_page=100" \
    --jq '.[] | [.environment, (.payload.service // "-"), .sha[0:7], (.payload.digest // "-"), .created_at[0:16], (.payload.image // "-")] | @tsv' \
    | awk -F'\t' '!seen[$1 FS $2]++' \
    | sort \
    | awk -F'\t' 'BEGIN { printf "  %-12s %-8s %-9s %-15s %-17s %s\n", "environment", "service", "sha", "digest", "when", "image" }
                    { printf "  %-12s %-8s %-9s %-15s %-17s %s\n", $1, $2, $3, $4, $5, $6 }'
}

doc github-branches "Apply the rig's branch model to the GitHub repo: main, PR + squash, pr / build (CHECK=1 only reports drift)"
task::github-branches() {
  local s="$RIG_DIR/plugins/github/branches.sh"
  [ -x "$s" ] || die "cannot find $s — run 'rig self update'"
  CHECK="${CHECK-}" "$s"
}

##############################################################################
## DOCTOR — does Renovate see the site?
#
# Renovate clones the repo and sees only tracked files. Credentials come from
# the central runner (Aventyret/renovate-config), the scope mapping does not:
# without @aventyret:registry in a TRACKED .npmrc Renovate asks npmjs.org for
# the private packages and gets 404. The lockfile's tarball URL does not help:
# it answers where the package lives, not which versions exist. The file is
# scaffolded from .npmrc.template and has historically been in .gitignore,
# which is the trap.
#
# The Renovate app is installed on selected repos only, so a new site must be
# added to the installation. Which repos are selected cannot be read with a
# user token; the Dependency Dashboard the app opens on its first run is the
# proof that it reaches the repo.
RIG_DOCTOR+=(renovate-doctor)
RIG_RENOVATE_APP="aventyret-renovate"

doc renovate-doctor "Doctor checks for Renovate (does it see the site and the private packages?)"
task::renovate-doctor() {
  local file app_dir slug
  rig_dr_section "🤖 Renovate sees the site..."
  if [ ! -f renovate.json ]; then
    rig_dr_fail "renovate.json is missing — the Renovate runner skips repos without it" \
      "run 'rig self update' and commit renovate.json"
  else
    rig_dr_ok "renovate.json exists"
  fi
  if [ -f .github/dependabot.yml ]; then
    rig_dr_warn ".github/dependabot.yml is still here — Dependabot and Renovate open PRs for the same updates"
  fi
  if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
    rig_dr_warn "skipping the app check: gh is missing or logged out"
  elif ! slug="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)" || [ -z "$slug" ]; then
    rig_dr_warn "skipping the app check: found no GitHub repo for origin"
  elif [ -n "$(gh issue list -R "$slug" --author "app/$RIG_RENOVATE_APP" --state all \
      --search 'in:title "Dependency Dashboard"' --json number -q '.[].number' 2>/dev/null)" ]; then
    rig_dr_ok "Renovate has run on $slug (Dependency Dashboard exists)"
  else
    rig_dr_warn "no Dependency Dashboard from $RIG_RENOVATE_APP on $slug yet — Renovate runs nightly once renovate.json is on main; if it stays missing, add the repo to the app at github.com/organizations/${slug%%/*}/settings/installations (Configure → Repository access)"
  fi
  for file in */.npmrc.template; do
    [ -f "$file" ] || continue
    app_dir="$(dirname "$file")"
    if grep -q '_authToken' "$file"; then
      rig_dr_warn "$file has an _authToken line — pnpm 11 does not expand \${NPM_TOKEN} in a project-level .npmrc (the token comes from the image's /service/.npmrc), and the line is the reason the file cannot be committed"
    fi
    if git ls-files --error-unmatch "$app_dir/.npmrc" >/dev/null 2>&1; then
      rig_dr_ok "$app_dir/.npmrc is tracked — Renovate sees the scope mapping"
    else
      rig_dr_fail \
        "$app_dir/.npmrc is not tracked — Renovate sees no @aventyret:registry and asks npmjs.org for the private packages" \
        "remove .npmrc from .gitignore and commit the file (without the _authToken line)"
    fi
  done
  rig_dr_verdict
}
