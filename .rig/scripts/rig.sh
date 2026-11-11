#!/usr/bin/env bash
set -euo pipefail

# rig.sh — connects a site to a pinned rig version. Run from the site's
# root via the rig plugin's tasks (never directly in daily work):
#
#   rig self setup  [version|path]     → rig.sh setup    first time: RIG_VERSION in
#                                        rigfile, .rig as symlink, scaffolds
#   rig self update [version|path]     → rig.sh update   switch pin (default: latest
#                                        release), update what the rig owns
#                                        outside .rig (stubs, renovate.json)
#   rig self status                    → rig.sh status   pin, source, latest release,
#                                                       what is pending (CHANGELOG)
#
# The model (docs/decisions/2026-08-30-simplify.md track 1): the site pins a
# version in rigfile, the updater fetches it to ~/.cache/aventyret-rig/
# versions/ and syncs the payload into .rig/ (scripts/rig-pin.sh), a committed
# copy, so the repo builds without access to aventyret-rig. The copy is the rig's and
# is overwritten on every update (no MANIFEST, no patch protection: local
# changes are listed and end up in the git diff). What the rig owns outside .rig/
# (workflow stubs, renovate.json, the README block, deploy scaffold, .env.rig) is written by
# the plugins' vendor.sh hooks and marked by the RIG-OWNED/RIG-SCAFFOLD header.
#
# The script runs from the version the site is pinned to (.rig/scripts/rig.sh) and
# switches pin by fetching the TARGET version and running its hooks, so an
# upgrade writes the stubs the way the new version wants them.

log() { echo "⚙️  rig: $*"; }
die() { echo "❌ $*" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=rig-decl.sh
. "$HERE/rig-decl.sh"
# shellcheck source=rig-pin.sh
. "$HERE/rig-pin.sh"

##############################################################################
## THE SITE'S DECLARATION

# rigfile is strict KEY=value (the runner validates; fleet reads the same form).
rigfile_var() { rig_decl_value rigfile "$1"; }

site_modules()         { rigfile_var RIG_MODULES; }
site_stacks()          { rigfile_var RIG_STACK; }
site_rig_site()        { rigfile_var RIG_SITE; }
site_deploy_services() { rigfile_var RIG_DEPLOY_SERVICES; }

has_module() {
  case " $(site_modules) " in
    *" $1 "*) return 0 ;;
    *)        return 1 ;;
  esac
}

# Write (or replace) a KEY=value line in rigfile. Creates the file if it is missing.
rigfile_set() {   # rigfile_set <KEY> <value>
  local key="$1" val="$2"
  if [ -f rigfile ] && grep -qE "^[[:space:]]*${key}[[:space:]]*=" rigfile; then
    awk -v k="$key" -v v="$val" '
      $0 ~ "^[[:space:]]*" k "[[:space:]]*=" && !done { print k "=" v; done = 1; next }
      { print }' rigfile > rigfile.tmp
    mv rigfile.tmp rigfile
  else
    printf '%s=%s\n' "$key" "$val" >> rigfile
  fi
}

##############################################################################
## RUNTIMES AND PLUGINS (from the target version)

# Runtime references (akka-tools names, earlier rig generations, today's
# paths) → today's runtime path under .rig/: plugins/<plugin>/docker/<service>.
map_runtime() {
  case "$1" in
    www|akka-www|docker/www|docker/akka-www) echo "plugins/nextjs/docker/www" ;;
    cms|akka-cms|docker/cms|docker/akka-cms) echo "plugins/wordpress/docker/cms" ;;
    wp|legacy-wp|docker/wp|docker/legacy-wp) echo "plugins/wordpress/docker/cms" ;;
    plugins/headless-wp/docker/cms|plugins/wp/docker/wp) echo "plugins/wordpress/docker/cms" ;;
    frameworks/*)                            echo "plugins/${1#frameworks/}" ;;
    *)                                       echo "$1" ;;
  esac
}

service_for_runtime()   { echo "${1##*/}"; }
framework_for_runtime() {
  case "$1" in
    plugins/*) echo "$1" | cut -d/ -f2 ;;
    *)         ;;
  esac
}

# Which runtimes does the site use? ${AKKA_TOOLS}/docker/<x> and .rig/
# references in the compose files (migration and today's layout, respectively).
discover_runtimes() {
  RUNTIMES=""
  COMPOSE_REFS=""
  local f found rt
  for f in compose.yaml compose.yml docker-compose.yml docker-compose.yaml compose.*.yml compose.*.yaml; do
    [ -f "$f" ] || continue
    found="$(grep -oE '(\$\{?AKKA_TOOLS\}?|\.rig)/((plugins|frameworks)/[a-zA-Z0-9_-]+/docker/[a-zA-Z0-9_-]+|docker/[a-zA-Z0-9_-]+)' "$f" 2>/dev/null \
      | sed -E 's|^\$\{?AKKA_TOOLS\}?/docker/||; s|^\.rig/||' || true)"
    for rt in $found; do
      COMPOSE_REFS="$COMPOSE_REFS $rt"
      RUNTIMES="$RUNTIMES $(map_runtime "$rt")"
    done
  done
  # shellcheck disable=SC2086
  RUNTIMES="$(echo $RUNTIMES | tr ' ' '\n' | { grep -v '^$' || true; } | sort -u | tr '\n' ' ')"
}

discover_frameworks() {
  FRAMEWORKS=""
  local rt fw
  for rt in $RUNTIMES; do
    fw="$(framework_for_runtime "$rt")"
    [ -n "$fw" ] && FRAMEWORKS="$FRAMEWORKS $fw"
  done
  FRAMEWORKS="$FRAMEWORKS $(site_stacks)"
  # shellcheck disable=SC2086
  FRAMEWORKS="$(echo $FRAMEWORKS | tr ' ' '\n' | { grep -v '^$' || true; } | sort -u | tr '\n' ' ')"
}

plugin_field() {   # plugin_field <plugin> <KEY> — from the target version's manifest
  rig_decl_value "$SRC/rig/plugins/$1/plugin.rig" "$2"
}

# Resolved plugins: stacks + modules from rigfile, their REQUIRES, and the
# always-loaded ones. Flat and deduped, the same model as the runner.
PLUGINS=""
add_plugin() {
  local p="$1" r
  case " $PLUGINS " in *" $p "*) return 0 ;; esac
  # The site's own plugin (rigplugins/): nothing to vendor, no warning;
  # the updater runs in the site's root, just as the runner finds it.
  [ -d "rigplugins/$p" ] && return 0
  [ -d "$SRC/rig/plugins/$p" ] || { log "⚠️  rig/plugins/$p does not exist in the rig — skipping"; return 0; }
  PLUGINS="$PLUGINS$p "
  for r in $(plugin_field "$p" REQUIRES); do
    add_plugin "$r"
  done
}

discover_plugins() {
  local p note
  for p in $(site_modules); do
    if [ "$(plugin_field "$p" SELECTABLE)" = no ]; then
      note="$(plugin_field "$p" NOTE)"
      die "rigfile: RIG_MODULES=$p — the plugin cannot be selected, it is pulled in via REQUIRES by those who need it. Remove '$p' from RIG_MODULES.${note:+ $note}"
    fi
  done
  PLUGINS=""
  for p in rig site runner proxy legacy $FRAMEWORKS $(site_modules); do
    add_plugin "$p"
  done
}

has_plugin() {
  case " $PLUGINS " in
    *" $1 "*) return 0 ;;
    *)        return 1 ;;
  esac
}

# Service → runtime path under .rig/, from compose (rig-compose.sh in
# the target version), normalized through map_runtime.
runtime_for_service() {
  local rt
  rt="$("$SRC/rig/scripts/rig-compose.sh" context "$1" 2>/dev/null || true)"
  case "$rt" in
    *.rig/*) rt="${rt#*.rig/}"; rt="${rt%/}" ;;
    *)       rt="" ;;
  esac
  if [ -n "$rt" ]; then
    map_runtime "$rt"
  else
    map_runtime "$1"
  fi
}

##############################################################################
## OWNER MARKERS — files outside .rig/

RIG_OWNED_HEADER="# RIG-OWNED (written by 'rig self update' — change it in the rig, not here)"
RIG_SCAFFOLD_HEADER="# RIG-SCAFFOLD (created by the rig, owned by the site)"

# Write the header as the first line if it is missing; update the wording if it
# changed. Idempotent.
mark_file() {
  local f="$1" header="$2" tag first
  [ -f "$f" ] || return 0
  tag="${header%% (*}"
  first="$(head -n 1 "$f")"
  [ "$first" = "$header" ] && return 0
  case "$first" in
    "$tag"*) { echo "$header"; tail -n +2 "$f"; } > "$f.tmp" ;;
    *)       { echo "$header"; cat "$f"; }       > "$f.tmp" ;;
  esac
  mv "$f.tmp" "$f"
}

# Rig-owned file? The header decides. A file the site wrote itself before the rig came in
# lacks it and is never touched.
rig_owned() {
  [ -f "$1" ] || return 1
  case "$(head -n 1 "$1")" in
    "${RIG_OWNED_HEADER%% (*}"*) return 0 ;;
  esac
  return 1
}

##############################################################################
## HOOKS — vendoring outside .rig/ is the plugins' business

# A plugin with files outside its own directory has a vendor.sh that
# defines `vendor_<plugin> <1|0>`. The hooks are sourced from the TARGET version and
# called for every plugin in it that has the file: 1 if the plugin is resolved in
# the site, 0 otherwise. So the convergence (clean up rig-owned files when the module is
# turned off) lives in the same function as the vendoring. The hooks may use: log, die,
# mark_file, rig_owned, stub_ref, has_plugin, RIG_OWNED_HEADER, RIG_SCAFFOLD_HEADER,
# RUNTIMES, SRC, PIN, the site_* helpers.
run_vendor_hooks() {
  local d p fn
  for d in "$SRC"/rig/plugins/*/; do
    [ -f "$d/vendor.sh" ] || continue
    p="$(basename "$d")"
    fn="vendor_$(printf '%s' "$p" | tr - _)"
    # shellcheck source=/dev/null
    . "$d/vendor.sh"
    type "$fn" >/dev/null 2>&1 || die "$d/vendor.sh does not define $fn"
    if has_plugin "$p"; then
      "$fn" 1
    else
      "$fn" 0
    fi
  done
}

# The @ reference the stubs should carry: the tag for a version pin (workflows and
# payload from the same release, zero skew), the checkout's branch for a
# path pin (so a rig branch can be run as a whole in a canary site).
stub_ref() {
  case "$(rig_pin_kind "$PIN")" in
    tag) printf 'v%s\n' "$PIN" ;;
    path) git -C "$SRC" rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'main\n' ;;
  esac
}

# <org>/<repo> from origin, both the SSH and the HTTPS form. Without a remote (a repo that
# has not been pushed yet) we guess Aventyret/<name>, where the name is RIG_SITE or,
# before setup has written it, the directory the site is in.
site_repo() {
  local url slug="" name
  url="$(git remote get-url origin 2>/dev/null || true)"
  case "$url" in
    *github.com[:/]*)
      slug="${url#*github.com}"
      slug="${slug#[:/]}"
      slug="${slug%.git}"
      ;;
  esac
  if [ -z "$slug" ]; then
    name="$(site_rig_site)"
    [ -n "$name" ] || name="$(basename "$PWD")"
    slug="Aventyret/$name"
  fi
  printf '%s\n' "$slug"
}

##############################################################################
## RENOVATE — renovate.json

# Dependency updates come from the central self-hosted Renovate
# (Aventyret/renovate-config), which only processes repos that have a
# renovate.json. The file is the opt-in and a pointer to the shared presets:
# schedule, grouping, registries and ACF Pro live there, not per site. A stack
# that needs more than the default declares its presets (RENOVATE= in
# plugin.rig) and they are appended as github>Aventyret/renovate-config:<preset>.
# github> on both platforms: the presets live on GitHub also for Azure sites.
#
# JSON has no comments, so the owner marker is the description field instead of
# the RIG-OWNED header line. A renovate.json without it is the site's and is
# never touched.
#
# Site rules go in renovate-site.json, which the site creates when it needs one
# and owns (docs/decisions/2026-10-19-renovate-site-preset.md). Its preset is
# appended last so the site wins. A repo's own renovate.json cannot extend a
# relative ./file, so it is the absolute local>, and only when the file exists:
# no empty file and no extra preset fetch in sites without rules.
RENOVATE_FILE="renovate.json"
RENOVATE_SITE_FILE="renovate-site.json"
RENOVATE_PRESET_REPO="github>Aventyret/renovate-config"
RENOVATE_OWNED_DESCRIPTION="${RIG_OWNED_HEADER#\# }"
# Replaced by renovate.json; removed when the rig wrote it.
DEPENDABOT_FILE=".github/dependabot.yml"

renovate_owned() {
  [ -f "$1" ] || return 1
  grep -q "^  \"description\": \"RIG-OWNED" "$1"
}

# The site's presets, one per line: the shared default first, then each
# framework's RENOVATE= in runtime order, deduped. Empty when the site has
# neither a stack nor github, and then there is nothing to update.
renovate_presets() {
  local rt fw p any="" extra=""
  has_plugin github && any=1
  for rt in $RUNTIMES; do
    fw="$(framework_for_runtime "$rt")"
    [ -n "$fw" ] || continue
    any=1
    for p in $(plugin_field "$fw" RENOVATE); do
      case " $extra " in *" $p "*) ;; *) extra="$extra $p" ;; esac
    done
  done
  [ -n "$any" ] || return 0
  echo "$RENOVATE_PRESET_REPO"
  for p in $extra; do
    echo "$RENOVATE_PRESET_REPO:$p"
  done
}

do_renovate() {
  local presets n i=0 p
  if rig_owned "$DEPENDABOT_FILE"; then
    rm -f "$DEPENDABOT_FILE"
    log "🧹 $DEPENDABOT_FILE removed (replaced by $RENOVATE_FILE)"
  fi
  presets="$(renovate_presets)"
  if [ -n "$presets" ] && [ -f "$RENOVATE_SITE_FILE" ]; then
    case "$(git remote get-url origin 2>/dev/null || true)" in
      ""|*github.com[:/]*)
        presets="$presets
local>$(site_repo):${RENOVATE_SITE_FILE%.json}"
        ;;
      *)
        # local> resolves on the runner's platform; the Azure slug form is untested.
        log "⚠️  $RENOVATE_SITE_FILE is only wired up for GitHub repos — not added to $RENOVATE_FILE"
        ;;
    esac
  fi
  if [ -z "$presets" ]; then
    if renovate_owned "$RENOVATE_FILE"; then
      rm -f "$RENOVATE_FILE"
      log "🧹 $RENOVATE_FILE removed (no stack and github is not resolved)"
    fi
    return 0
  fi
  if [ -f "$RENOVATE_FILE" ] && ! renovate_owned "$RENOVATE_FILE"; then
    log "⚠️  $RENOVATE_FILE already exists (not rig-vendored) — skipping; remove the file and rerun for the rig's version"
    return 0
  fi
  n="$(printf '%s\n' "$presets" | wc -l | tr -d ' ')"
  {
    echo "{"
    echo "  \"\$schema\": \"https://docs.renovatebot.com/renovate-schema.json\","
    echo "  \"description\": \"$RENOVATE_OWNED_DESCRIPTION\","
    echo "  \"extends\": ["
    while IFS= read -r p; do
      i=$((i + 1))
      if [ "$i" -lt "$n" ]; then echo "    \"$p\","; else echo "    \"$p\""; fi
    done <<EOF
$presets
EOF
    echo "  ]"
    echo "}"
  } > "$RENOVATE_FILE"
  log "📦 $RENOVATE_FILE ($(printf '%s\n' "$presets" | tr '\n' ' ' | sed 's/ $//'))"
}

##############################################################################
## README — the getting started block in the site's README.md
#
# The sites' READMEs age silently: most still describe
# make commands from the akka-tools era, and a designer who clones the repo follows
# them. The block between the markers is the rig's, the rest of the file the site's; the same
# split as the workflow stubs, but inside a file the site owns (and therefore
# markers instead of the RIG-OWNED header). The content is derived from the site
# itself: the repo slug from origin, the addresses from rig.hosts. So it cannot
# go stale as long as `rig self update` is run, which is the whole point.

README_FILE="README.md"
README_START="<!-- rig:start -->"
README_END="<!-- rig:end -->"

# The site's addresses: rig.hosts per service (rig-compose table, fifth field) with
# ${RIG_HOST_BASE} replaced by RIG_SITE, the main checkout's value, which is what
# the README describes (a worktree gets its own base from `rig env`). Services without
# the label have no ingress and do not belong in the list. Without RIG_SITE (setup
# only writes it in step 2) the list is empty and the next update fills it.
readme_hosts() {
  local site svc hosts urls n
  site="$(site_rig_site)"
  [ -n "$site" ] || return 0
  "$SRC/rig/scripts/rig-compose.sh" table 2>/dev/null | while IFS='|' read -r svc _ _ _ hosts; do
    [ -n "$hosts" ] || continue
    hosts="$(printf '%s' "$hosts" | sed "s/\${RIG_HOST_BASE}/$site/g")"
    n="$(printf '%s' "$hosts" | awk -F, '{print NF}')"
    # Up to three addresses are printed; a site with twelve domains (almega) should
    # not drown the block, and the rest are in the compose file anyway.
    if [ "$n" -le 3 ]; then
      urls="$(printf '%s' "$hosts" | sed 's|[^,]*|https://&|g; s|,|, |g')"
      printf -- '- **%s** — %s\n' "$svc" "$urls"
    else
      printf -- '- **%s** — https://%s and %s more (see `compose.yaml`)\n' \
        "$svc" "${hosts%%,*}" "$((n - 1))"
    fi
  done
}

readme_block() {
  local repo hosts dir docs="https://github.com/Aventyret/aventyret-rig/blob/main/docs"
  repo="$(site_repo)"
  dir="${repo#*/}"
  hosts="$(readme_hosts)"
  echo "$README_START"
  echo "<!-- Written by 'rig self update'. Change it in the rig, not here. -->"
  echo
  echo "## Getting started locally"
  echo
  echo "The site runs on your computer with [the rig](https://github.com/Aventyret/aventyret-rig)."
  echo "If your computer is not set up yet, start with [GETTING_STARTED.md]($docs/GETTING_STARTED.md)."
  echo
  echo "**The first time:** get the repo and set up the site."
  echo
  echo '```bash'
  echo "gh repo clone $repo"
  echo "cd $dir"
  echo "rig setup"
  echo '```'
  echo
  echo "**Every time you work on the site:** start it. \`Ctrl + C\` stops it again."
  echo
  echo '```bash'
  echo "rig up"
  echo '```'
  if [ -n "$hosts" ]; then
    echo
    echo "The site is then available at:"
    echo
    printf '%s\n' "$hosts"
  fi
  echo
  echo "For daily work, \`rig up\`, \`rig down\`, \`rig logs\` and"
  echo "\`rig doctor\` are enough. \`rig help\` lists everything you can do in this"
  echo "particular site, and [CHEATSHEET.md]($docs/CHEATSHEET.md) is the everyday reference."
  echo
  echo "$README_END"
}

do_readme() {
  local block tmp
  block="$(readme_block)"
  if [ ! -f "$README_FILE" ]; then
    {
      printf '# %s\n\n' "$(site_repo | sed 's|.*/||')"
      printf '%s\n' "$block"
    } > "$README_FILE"
    log "📖 $README_FILE created with the getting started block"
    return 0
  fi
  tmp="$(mktemp)"
  printf '%s\n' "$block" > "$tmp"
  if grep -qF "$README_START" "$README_FILE"; then
    # Half a marking: someone has deleted the end marker. Writing anyway would
    # eat the rest of the file; say so instead, it is a file the site owns.
    if ! grep -qF "$README_END" "$README_FILE"; then
      rm -f "$tmp"
      log "⚠️  $README_FILE has $README_START but no $README_END — skipping; put the end marker back"
      return 0
    fi
    awk -v b="$tmp" -v s="$README_START" -v e="$README_END" '
      !skip && index($0, s) == 1 {
        while ((getline l < b) > 0) print l
        close(b)
        skip = 1
        next
      }
      skip { if (index($0, e) == 1) skip = 0; next }
      { print }
    ' "$README_FILE" > "$README_FILE.tmp"
    log "📖 $README_FILE (getting started block rewritten)"
  elif grep -qE '^## ' "$README_FILE"; then
    # The first time: before the first section, i.e. after the heading and the
    # introductory description but above everything else. The block should be where
    # someone who opens the repo looks, without wedging itself into the middle of a sentence.
    awk -v b="$tmp" '
      !done && /^## / {
        while ((getline l < b) > 0) print l
        close(b)
        print ""
        done = 1
      }
      { print }
    ' "$README_FILE" > "$README_FILE.tmp"
    log "📖 $README_FILE (getting started block inserted before the first section)"
  else
    # No section heading to go before: the file is short enough that the block
    # can go last without disappearing.
    { cat "$README_FILE"; printf '\n%s\n' "$block"; } > "$README_FILE.tmp"
    log "📖 $README_FILE (getting started block added last)"
  fi
  rm -f "$tmp"
  mv "$README_FILE.tmp" "$README_FILE"
}

##############################################################################
## .env.rig — local answers for rig:// references (scaffold, the site's afterwards)

ENV_RIG_PREAMBLE='# .env.rig — local answers for rig:// references in the .env.template files.
# rig://<service>/<facet> is looked up here as <SERVICE>_<FACET> (rig://cms/url →
# CMS_URL); on Cloud Run `rig gcloud-env` resolves the same references against the
# real environment. Committed; no secrets here: dev passwords for local
# throwaway services are fine (rig-secret://db/password reads DB_PASSWORD).
#
# ${RIG_HOST_BASE} is expanded by `rig env` (requires RIG_SITE in the rigfile):
# the main checkout = <site>, a linked git worktree = <site>-<branchslug>,
# so the same committed file gives the right domains in every parallel worktree environment.
'
do_env_rig_scaffold() {
  if [ -f .env.rig ]; then return 0; fi
  local fw tpl site site_db found=0
  site="$(site_rig_site)"
  [ -n "$site" ] || site="$(basename "$PWD")"
  site_db="$(printf '%s' "$site" | tr -c 'a-z0-9_' '_' | sed 's/_*$//')"
  for fw in $FRAMEWORKS; do
    tpl="$SRC/rig/plugins/$fw/env.rig"
    [ -f "$tpl" ] || continue
    if [ "$found" = 0 ]; then
      printf '%s\n' "$ENV_RIG_PREAMBLE" > .env.rig
    else
      printf '\n' >> .env.rig
    fi
    sed -e "s/__SITE_DB__/$site_db/g" -e "s/__SITE__/$site/g" "$tpl" >> .env.rig
    found=1
  done
  if [ "$found" = 1 ]; then
    mark_file .env.rig "$RIG_SCAFFOLD_HEADER"
    log "📦 .env.rig (scaffold, the site's own: adjust local URLs/values and commit)"
  fi
  return 0
}

##############################################################################
## THE PIN

# Target pin: argument > $RIG_SOURCE (local checkout, tests) > current pin
# (if it is a path: the developer has deliberately pointed to a checkout) >
# latest release on the remote.
resolve_pin() {   # resolve_pin [arg] → PIN
  local cur
  cur="$(rigfile_var RIG_VERSION)"
  if [ -n "${1-}" ]; then
    PIN="$1"
  elif [ -n "${RIG_SOURCE:-}" ]; then
    PIN="$(cd "$RIG_SOURCE" && pwd -P)"
  elif [ "$(rig_pin_kind "${cur:-x}" 2>/dev/null || true)" = path ]; then
    PIN="$cur"
  else
    # A candidate pin is a deliberate choice: without an argument the updater would
    # switch to the latest FINAL release, i.e. backwards, away from what the site
    # is set to test, and silently. Require the version spelled out instead.
    case "$cur" in
      *-rc.*)
        die "the pin is the candidate $cur — give the version: 'rig self update <version>' (the next candidate, or ${cur%%-rc.*} once it is promoted)"
        ;;
    esac
    PIN="$(rig_pin_latest || true)"
    [ -n "$PIN" ] || die "could not look up the latest release (is $RIG_REPO_URL reachable? logged in with gh?) — give the version: rig self update <version>"
  fi
  case "$(rig_pin_kind "$PIN")" in
    path) log "pin: $PIN (local checkout)" ;;
    *)    log "pin: $PIN" ;;
  esac
  SRC="$(rig_pin_source "$PIN")" || exit 1
}

# .rig/ is committed. The short-lived symlink model put the line in .gitignore; remove
# it, otherwise the copy is never committed.
ensure_tracked() {
  [ -f .gitignore ] || return 0
  grep -qxE '/?\.rig/?' .gitignore || return 0
  grep -vxE '/?\.rig/?' .gitignore > .gitignore.tmp || true
  mv .gitignore.tmp .gitignore
  log ".gitignore: the .rig line removed — the copy is committed"
}

# Local changes in .rig/ are overwritten by the sync. They are listed so that the deviation
# can be moved to EXTRA_* args, an overlay or rigplugins/, and they remain
# in the git history. The comparison is made against the pin the copy CAME FROM: against
# the target version, the update's own diff would have been listed as local changes
# (a finding from the fleet rollout). A vendored copy from v1 without a stamp
# always differs (different payload), so nothing is listed per file there.
warn_drift() {
  local drift stamp from
  [ -d .rig ] && [ ! -L .rig ] || return 0
  stamp="$(rig_pin_stamp "$PWD")"
  if [ -z "$stamp" ]; then
    log "switching from vendored .rig/ (the v1 generation) to a pinned copy — MANIFEST/VERSION go away"
    return 0
  fi
  if [ "$stamp" = "$PIN" ]; then
    from="$SRC"
  elif ! from="$(rig_pin_source "$stamp" 2>/dev/null)"; then
    log "the pin $stamp cannot be fetched — local changes in .rig/ cannot be told apart from the update (they remain in the git history)"
    return 0
  fi
  drift="$(rig_pin_drift "$PWD" "$from")"
  [ -n "$drift" ] || return 0
  echo "⚠️  local changes in .rig/ are overwritten by the sync (they are in the git history):"
  echo "$drift" | sed 's/^/     /'
  echo "     move the deviation to EXTRA_* build args, an overlay Dockerfile or rigplugins/ (MIGRATE_TO_RIG.md 3g)"
}

apply_pin() {
  ensure_tracked
  warn_drift
  rig_pin_copy "$PWD" "$SRC" "$PIN"
  rigfile_set RIG_VERSION "$PIN"
  log "📦 .rig/ ← $SRC/rig ($PIN)"
}

# Everything the rig owns outside .rig/, from the target version.
apply_outside() {
  discover_runtimes
  discover_frameworks
  discover_plugins
  run_vendor_hooks
  do_renovate
  do_readme
  do_env_rig_scaffold
}

# What the switch means for the site, from the target version's rig/CHANGELOG.md (written for
# the sites, one line per change; docs/decisions/2026-08-30-changelog.md).
# Only between tag pins: a path pin is a developer's checkout. Empty
# <from> (vendored v1 copy) gives everything up to and including <to>. The headings in
# the file are final versions, so an rc reads its final version's section.
show_changelog() {   # show_changelog <source> <from pin> <to pin> <heading>
  local src="$1" from="$2" to="$3" text
  [ "$(rig_pin_kind "$to" 2>/dev/null || true)" = tag ] || return 0
  [ -z "$from" ] || [ "$(rig_pin_kind "$from" 2>/dev/null || true)" = tag ] || return 0
  [ -x "$src/rig/scripts/rig-changelog.sh" ] && [ -f "$src/rig/CHANGELOG.md" ] || return 0
  text="$("$src/rig/scripts/rig-changelog.sh" between "$src/rig/CHANGELOG.md" "${from%%-rc.*}" "${to%%-rc.*}" 2>/dev/null || true)"
  [ -n "$text" ] || return 0
  echo
  echo "📋 $4 (.rig/CHANGELOG.md):"
  printf '%s\n' "$text" | sed 's/^/   /'
  echo
}

##############################################################################
## COMMANDS

# Is cwd an aventyret-rig checkout? The same predicate rig_pin_source uses
# for a path pin. The checkout has a compose file (the rig proxy) and would
# otherwise pass setup's guard, and a rig pinned inside itself is not something
# anyone means (since the self namespace became reachable outside a site, issue #49).
is_rig_checkout() {
  [ -d rig/plugins ] && [ -f rig/bin/rig ]
}

cmd_setup() {
  ! is_rig_checkout \
    || die "this is an aventyret-rig checkout, not a site — run 'rig self setup' in the site repo's root"
  [ -f compose.yaml ] || [ -f compose.yml ] || [ -f docker-compose.yml ] || [ -f docker-compose.yaml ] \
    || die "no compose file here — run from the site repo's root"
  [ -z "$(rigfile_var RIG_VERSION)" ] || die "rigfile already has RIG_VERSION — run 'rig self update' instead"
  resolve_pin "${1-}"
  apply_pin
  apply_outside
  local services stacks
  services="$(for rt in $RUNTIMES; do service_for_runtime "$rt"; done | sort -u | tr '\n' ' ')"
  stacks="$(echo "$FRAMEWORKS" | sed 's/ *$//')"
  echo ""
  log "✅ the site is connected to the rig. Next steps (one-time changes, commit afterwards):"
  if [ -n "$stacks" ]; then
    echo "     1. compose:   build.context: → .rig/plugins/<stack>/docker/<service>/"
    echo "                   (runtimes: $RUNTIMES)"
    echo "     2. rigfile:   RIG_STACK=$stacks"
    echo "                   RIG_MODULES=github          # the rig owns the GitHub flow ⇒ level delivery; without: stack"
  else
    echo "     1. compose:   unchanged — the site owns its Dockerfiles (level contract)"
    echo "     2. rigfile:   RIG_MODULES=db              # shared services (no RIG_STACK ⇒ level contract)"
  fi
  echo "                   RIG_SITE=<site name>"
  echo "                   RIG_DEPLOY_SERVICES=$services"
  echo "                   (rigfile is strict KEY=value — no commands, no expansion)"
  echo "     3. rig self update          # writes what the modules own outside .rig: github → stubs, gcloud → deploy/"
  echo "     4. adjust .env.rig (local answers for rig:// references in .env.template)"
  echo "     5. own tasks? put them in rigtasks.sh (bash: doc + task::name)"
  echo "     6. git add .rig rigfile .github deploy .env.rig && commit"
  echo "     GCP dev hosting (optional, requires a stack with deploy templates):"
  echo "     7. add gcloud to RIG_MODULES (pulls in github) + rig self update && rig gcloud setup"
  echo "     8. rig github-branches     # main + PR/squash + pr / build (after the first PR workflow run)"
}

cmd_update() {
  local old
  ! is_rig_checkout \
    || die "this is an aventyret-rig checkout, not a site — the self tasks apply to site repos"
  # RIG_UPDATE_FROM: the pin before the switch, set by the old updater when it
  # hands over below.
  old="${RIG_UPDATE_FROM-$(rigfile_var RIG_VERSION)}"
  [ -n "$old" ] || [ -d .rig ] || die "no rigfile pin and no .rig/ — run 'rig self setup' first"
  # An explicit argument is a new pin; without an argument: the same pin if it is
  # a path, otherwise the latest release (resolve_pin).
  resolve_pin "${1-}"
  apply_pin
  # Hand over to the target version's updater, so that everything outside .rig/
  # is written by the version it belongs to and not by the one being replaced
  # (otherwise a changed generator needs a second run). Repeating apply_pin
  # there is idempotent; the variable stops the loop.
  if [ -z "${RIG_UPDATE_FROM+set}" ]; then
    RIG_UPDATE_FROM="$old" exec "$SRC/rig/scripts/rig.sh" update "$PIN"
  fi
  apply_outside
  if [ "$old" = "$PIN" ]; then
    log "✅ already on $PIN — the copy and what the rig owns outside .rig are rewritten from it"
  else
    log "✅ ${old:-vendored} → $PIN — review with 'git status' (.rig, rigfile, .github) and commit"
    show_changelog "$SRC" "$old" "$PIN" "new since ${old:-the v1 generation}"
  fi
}

cmd_status() {
  local pin latest src base
  pin="$(rigfile_var RIG_VERSION)"
  if [ -z "$pin" ]; then
    if [ -d .rig ]; then
      log "vendored .rig/ without a pin (the v1 generation) — 'rig self update' switches to a pinned version"
    elif is_rig_checkout; then
      log "an aventyret-rig checkout, not a site — the self tasks apply to site repos"
    else
      log "not set up — run 'rig self setup'"
    fi
    return 0
  fi
  log "pin: $pin"
  local stamp
  stamp="$(rig_pin_stamp "$PWD")"
  if [ "$stamp" = "$pin" ]; then
    log "📦 .rig/ is in sync with the pin"
  else
    log "⚠️  .rig/ is from '${stamp:-no stamp}' but rigfile pins $pin — run 'rig self update' and commit"
  fi
  case "$(rig_pin_kind "$pin")" in
    path) log "local checkout: $(git -C "$pin" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?') @ $(git -C "$pin" rev-parse --short HEAD 2>/dev/null || echo '?')" ;;
    tag)
      latest="$(rig_pin_latest || true)"
      # The candidate pin (2.16.0-rc.1) is compared on its FINAL version: otherwise
      # a canary site is always "behind" the latest final release and is told to go
      # backwards, to a release that is older than what it is set to test.
      base="${pin%%-rc.*}"
      if [ -z "$latest" ]; then
        log "⚠️  could not reach $RIG_REPO_URL to look up the latest release — logged in with gh (gh auth login)?"
      elif [ "$latest" = "$pin" ]; then
        log "✅ latest release"
      elif [ "$pin" != "$base" ] && [ "$base" = "$(rig_pin_newest "$base" "$latest")" ]; then
        if [ "$base" = "$latest" ]; then
          log "⬆️  $base is promoted — 'rig self update $base' switches from the candidate to the release"
        else
          log "🧪 candidate: $base is not promoted yet (the latest final release is $latest)"
          log "    the pin is ahead on purpose — 'rig self update <version>' when you want to switch"
        fi
      else
        log "⬆️  the latest release is $latest — 'rig self update' switches pin (or 'rig self update $latest')"
        # Fetches the release into the cache (rig-update needs it anyway) to
        # show what is pending; an error here only means the text is missing.
        if src="$(rig_pin_source "$latest")"; then
          show_changelog "$src" "$pin" "$latest" "new in $latest since $pin"
        fi
      fi
      ;;
  esac
}

case "${1:-}" in
  setup)  shift; cmd_setup "$@" ;;
  update) shift; cmd_update "$@" ;;
  status) cmd_status ;;
  *) die "usage: rig.sh {setup|update|status} [version|path]" ;;
esac
