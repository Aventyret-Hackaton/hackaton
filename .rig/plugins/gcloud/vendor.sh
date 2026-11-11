# gcloud/vendor.sh — vendoring outside .rig/: Cloud Run service YAML per
# service → deploy/<service>.dev.yaml (the name CI uses in `gcloud run
# services replace`). Sourced by rig.sh (setup/update) and called as
# `vendor_gcloud <1|0>`. The template is chosen via the service's runtime:
# plugins/<plugin>/docker/<svc> → plugins/<plugin>/deploy/<svc>.dev.yaml.
#
# Pure scaffold: copied only if the file is missing, the site owns it after
# that (rig-update does not touch it, and does not clean it up either
# when the module is turned off).
#
# A service with no template AND no deploy file of its own is a hard error:
# gcloud on a stack without GCP support must say so here, at scaffold time,
# instead of staying silent and letting gcloud setup create Cloud Run services
# that can never get a working infra spec. Which stacks have templates is
# derived from the rig itself (plugins/*/deploy/), no list to maintain.
vendor_gcloud() {
  [ "$1" = 1 ] || return 0
  local site services svc rt tpl dest missing="" paved
  site="$(site_rig_site)"
  [ -n "$site" ] || site="$(basename "$PWD")"
  services="$(site_deploy_services)"
  # Without RIG_DEPLOY_SERVICES: assume the services are named after the last
  # segment of the runtime paths (the role names).
  if [ -z "$(echo "$services" | tr -d ' ')" ]; then
    services="$(for rt in $RUNTIMES; do service_for_runtime "$rt"; done | tr '\n' ' ')"
  fi
  for svc in $services; do
    dest="deploy/$svc.dev.yaml"
    # The name was deploy/<service>.develop.yaml in the develop/main model: the
    # file belongs to the site, so it is renamed (not rewritten). The
    # environment is called dev, not the branch.
    if [ -f "deploy/$svc.develop.yaml" ] && [ ! -f "$dest" ]; then
      git mv "deploy/$svc.develop.yaml" "$dest" 2>/dev/null || mv "deploy/$svc.develop.yaml" "$dest"
      log "📦 deploy/$svc.develop.yaml → $dest (the environment is called dev, not the branch)"
    fi
    [ -f "$dest" ] && continue
    rt="$(runtime_for_service "$svc")"
    tpl="$SRC/rig/$(echo "$rt" | sed 's|/docker/|/deploy/|').dev.yaml"
    if [ ! -f "$tpl" ]; then
      missing="$missing $svc"
      continue
    fi
    mkdir -p deploy
    sed "s/__SITE__/$site/g" "$tpl" > "$dest"
    mark_file "$dest" "$RIG_SCAFFOLD_HEADER"
    log "📦 $dest (scaffold, owned by the site: adjust scaling/resources and commit)"
  done
  if [ -n "$missing" ]; then
    paved="$(cd "$SRC/rig/plugins" && ls -d ./*/deploy 2>/dev/null | sed 's|^\./||;s|/deploy$||' | tr '\n' ' ')"
    paved="${paved% }"
    die "gcloud is enabled but a deploy template is missing for:$missing
   Stacks with GCP deploy templates in the rig: ${paved:-none}. Other stacks
   are not supported for GCP dev hosting yet. They get support when templates
   and prod builds exist in their plugin (see docs/decisions/2026-08-01-ci-cd-plan.md).
   Alternatives: write your own deploy/<service>.dev.yaml (the site owns the file),
   or remove gcloud from RIG_MODULES."
  fi
}
