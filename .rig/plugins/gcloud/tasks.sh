# gcloud — onboarding and operations in the shared GCP dev project
# (docs/decisions/2026-08-01-ci-cd-plan.md 1.3).
#
# Deliberately separate from ci: the build contract (ci-build/ci-push) is
# cloud-neutral and runs anywhere, while this is a GCP-specific layer on top.
# The plugin requires github (deploys run from the workflows) and vendors
# deploy/<service>.dev.yaml via vendor.sh at rig-setup/update.
#
# The ownership model (who sets what on the Cloud Run service):
#   deploy/<service>.dev.yaml  infra skeleton — 'rig gcloud-apply'
#   <service>/.env.template        env + secrets — 'rig gcloud-env'
#   CI                             image + the revision's URL env
# Each thing has exactly one owner. CI never overwrites infra or non-URL
# env, and the tasks here never overwrite the image.

# The script lives in the plugin, not in rig/scripts/: the gcloud plugin is its
# only caller, so the 676 lines of GCP logic are vendored only to sites that
# have gcloud in RIG_MODULES. Everything rig.sh needs must however live in
# scripts/. The bootstrapper decides which plugins are vendored and cannot
# depend on a plugin being present.
gcloud_script() {
  local s="$RIG_DIR/plugins/gcloud/rig-gcloud.sh"
  [ -x "$s" ] || die "cannot find $s — run 'rig self update'"
  printf '%s\n' "$s"
}

gcloud_require_services() {
  [ -n "${RIG_DEPLOY_SERVICES-}" ] \
    || die "RIG_DEPLOY_SERVICES is empty — declare it in rigfile"
}

# Preflight: everything the onboarding assumes must exist in the repo BEFORE
# anything touches the cloud. Without a deploy template the service can never
# get a working infra spec (gcloud-apply), and without .env.template there is
# no env contract to sync. site-init would otherwise have created Cloud Run
# services that can never really start, and the error would only show in CI.
gcloud_preflight() {
  gcloud_require_services
  local svc dir missing=""
  for svc in $RIG_DEPLOY_SERVICES; do
    dir="$(gcloud_service_dir "$svc")"
    [ -f "deploy/$svc.dev.yaml" ] || missing="$missing deploy/$svc.dev.yaml"
    [ -f "$dir/.env.template" ]       || missing="$missing $dir/.env.template"
  done
  [ -z "$missing" ] || die "the GCP onboarding requires files that are missing:$missing
   the deploy template is scaffolded by 'rig self update' if the stack has one in
   the rig. Otherwise the stack is not supported for GCP dev yet (or the site
   writes its own deploy/<service>.dev.yaml). Nothing has been touched in GCP."
}

# The service's env template directory: same answer as the CI build's app
# context (label rig.src in compose for a deviating layout, otherwise ./<service>).
gcloud_service_dir() {
  rig_compose_src "$1"
}

# The whole onboarding in one command: the preflight guarantees that
# apply/env-sync can succeed, so there is no reason to stop after site-init and
# ask the user to run two more commands.
doc gcloud-setup "Onboard the site in the GCP dev project (WIF, Cloud Run, gh variables) + apply infra & sync env"
task::gcloud-setup() {
  gcloud_preflight
  RIG_SITE="$RIG_SITE" RIG_DEPLOY_SERVICES="${RIG_DEPLOY_SERVICES-}" \
    "$(gcloud_script)" site-init
  need gcloud-apply
  echo "✅ GCP onboarding done — CI deploys main to dev from the next push on"
}

doc gcloud-env "Sync env + secrets from <service>/.env.template to the Cloud Run services"
task::gcloud-env() {
  gcloud_preflight
  local svc
  for svc in $RIG_DEPLOY_SERVICES; do
    RIG_SITE="$RIG_SITE" "$(gcloud_script)" env-sync "$svc" "$(gcloud_service_dir "$svc")/.env.template"
  done
}

doc gcloud-apply "Apply deploy/<service>.dev.yaml (infra skeleton) + sync env"
task::gcloud-apply() {
  gcloud_preflight
  local svc dir
  for svc in $RIG_DEPLOY_SERVICES; do
    dir="$(gcloud_service_dir "$svc")"
    RIG_SITE="$RIG_SITE" "$(gcloud_script)" apply "$svc"
    RIG_SITE="$RIG_SITE" "$(gcloud_script)" env-sync "$svc" "$dir/.env.template"
  done
}

# CI helper: print the revision's URL env pairs for a service (canonical URLs).
doc gcloud-revision-env "Print URL env pairs per revision: rig gcloud revision-env <service>"
task::gcloud-revision-env() {
  local svc="${1-}"
  [ -n "$svc" ] || die "usage: rig gcloud revision-env <service>"
  RIG_SITE="$RIG_SITE" "$(gcloud_script)" revision-env \
    "$svc" "$(gcloud_service_dir "$svc")/.env.template"
}

##############################################################################
## DOCTOR
#
# Same file requirements as gcloud_preflight, but reporting: the gap should
# show in the doctor without anyone having to try a deploy. The check used to
# live in site behind `has_word gcloud "$RIG_LOADED"`. Now it lives with its owner.

RIG_DOCTOR+=(gcloud-doctor)

doc gcloud-doctor "Doctor checks for GCP dev (deploy template + env contract)"
task::gcloud-doctor() {
  rig_dr_section "☁️  GCP dev (the gcloud module)..."
  if [ -z "${RIG_DEPLOY_SERVICES-}" ]; then
    rig_dr_fail "RIG_DEPLOY_SERVICES is empty" "declare it in rigfile"
    return 1
  fi
  local svc dir missing=""
  for svc in $RIG_DEPLOY_SERVICES; do
    dir="$(gcloud_service_dir "$svc")"
    [ -f "deploy/$svc.dev.yaml" ] || missing="$missing deploy/$svc.dev.yaml"
    [ -f "$dir/.env.template" ]       || missing="$missing $dir/.env.template"
  done
  if [ -z "$missing" ]; then
    rig_dr_ok "deploy template + .env.template exist for: $RIG_DEPLOY_SERVICES"
  else
    rig_dr_fail "files required by the GCP onboarding are missing:$missing" \
      "rig self update scaffolds the deploy template if the stack has one in the rig. Otherwise the stack is not supported for GCP dev yet"
  fi
  rig_dr_verdict
}
