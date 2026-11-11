# github/vendor.sh — what the rig owns outside .rig/: the thin workflow
# stubs in the site's .github/workflows/. Sourced by rig.sh (setup/update) and
# called as `vendor_github <1|0>`: 1 when the plugin is resolved in the site
# (rigfile or REQUIRES), 0 otherwise. May use rig.sh's helpers: log,
# die, mark_file, rig_owned, stub_ref, has_plugin, rigfile_var,
# RIG_OWNED_HEADER, SRC.
#
# The stubs are rig-owned (the RIG-OWNED header) and rewritten on every update
# with the @ reference = the site's pin, so workflows and payload always come from
# the same release. A file the site created itself before the rig came in is never
# overwritten and never removed. Convergent: with the plugin off the rig-owned ones are cleaned up.
# RIG_GITHUB_SKIP in rigfile opts out of individual stubs (name without .yml);
# they are treated as if they did not exist in the source.
#
vendor_github() {
  local src="$SRC/rig/plugins/github/stubs" f name dest tag
  [ -d "$src" ] || return 0
  if [ "$1" = 0 ]; then
    for f in "$src"/*.yml; do
      dest=".github/workflows/$(basename "$f")"
      if rig_owned "$dest"; then
        rm -f "$dest"
        log "🧹 $dest removed (github is not resolved, neither in RIG_MODULES nor pulled in via REQUIRES; rig-update puts it back when the plugin is enabled)"
      fi
    done
    return 0
  fi
  mkdir -p .github/workflows
  tag="$(stub_ref)"
  # The deploy-dev jobs call the site's own deploy.yml. GitHub rejects the whole
  # workflow when that file is missing, so they are cut unless the site has one
  # (docs/decisions/2026-10-20-ci-cd-boundary.md §6).
  local site_deploy=0
  if [ -f .github/workflows/deploy.yml ] && ! rig_owned .github/workflows/deploy.yml; then
    site_deploy=1
  fi
  local skip
  skip=" $(rigfile_var RIG_GITHUB_SKIP) "
  for name in $skip; do
    [ -f "$src/$name.yml" ] || log "⚠️  RIG_GITHUB_SKIP: no stub is named '$name' (available: $(cd "$src" && ls *.yml | sed 's/\.yml$//' | tr '\n' ' '))"
  done
  # Convergent also with the plugin ON: a rig-owned stub that no longer exists in
  # the source (develop.yml from the develop/main model) is cleaned up. The site's own
  # workflows lack the header and are not touched.
  for f in .github/workflows/*.yml; do
    [ -f "$f" ] || continue
    name="$(basename "$f")"
    if rig_owned "$f" && [ ! -f "$src/$name" ]; then
      rm -f "$f"
      log "🧹 $f removed (the stub no longer exists in the rig)"
    fi
  done
  local vendored=""
  for f in "$src"/*.yml; do
    name="$(basename "$f")"
    dest=".github/workflows/$name"
    case "$skip" in
      *" ${name%.yml} "*)
        if rig_owned "$dest"; then
          rm -f "$dest"
          log "🧹 $dest removed (RIG_GITHUB_SKIP)"
        fi
        continue
        ;;
    esac
    # deploy.yml belongs to the deploy module: the button is meaningless (deploy-plan
    # does not exist) without it. Same convergence as for the plugin off.
    if [ "$name" = deploy.yml ] && ! has_plugin deploy; then
      if rig_owned "$dest"; then
        rm -f "$dest"
        log "🧹 $dest removed (the module deploy is not resolved)"
      fi
      continue
    fi
    if [ -f "$dest" ] && ! rig_owned "$dest"; then
      log "⚠️  $dest already exists (not rig-owned) — skipping; compare with .rig/plugins/github/stubs/$name"
      continue
    fi
    # The source's @ ref (v<major>, a placeholder) is replaced with the pin.
    if [ "$site_deploy" = 1 ]; then
      sed "s|\(aventyret-rig/\.github/workflows/[^@]*\)@[^ ]*|\1@$tag|" "$f" > "$dest"
    else
      sed -e "s|\(aventyret-rig/\.github/workflows/[^@]*\)@[^ ]*|\1@$tag|" \
        -e '/# site-deploy: begin/,/# site-deploy: end/d' "$f" > "$dest"
    fi
    mark_file "$dest" "$RIG_OWNED_HEADER"
    vendored="$vendored${vendored:+, }${name%.yml}"
  done
  log "📦 .github/workflows/ (stubs: $vendored)"
}
