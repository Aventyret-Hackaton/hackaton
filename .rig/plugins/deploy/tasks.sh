# deploy — targets and dispatch to provider adapters.
#
# The model (docs/decisions/2026-08-30-site-release-ux.md): branches describe
# code, environments run artifacts. A TARGET is a deployable installation of the site
# (stage, production-no, ...), declared in deploy/targets/<target>.rig with
# strict keys (same parser as rigfile, so fleet can read the file without
# running it). A PROVIDER is the hosting type's adapter and decides how the artifact
# is placed; workflows and developers run the same `rig deploy` regardless of provider.
#
# The provider contract: a plugin that is a provider does exactly three things:
#
#   RIG_PROVIDERS[${#RIG_PROVIDERS[@]}]=<name>
#   <name>_target_keys()        → allowed keys in the target file (in addition to
#                                 RIG_TARGET_PROVIDER); per-service keys
#                                 with a * suffix: RIG_TARGET_ROOT_*
#   <name>_provider_deploy <target> <service> <image>
#   <name>_provider_running <target> <service>   → what runs there now (one line)
#
# Optional: <name>_auth_kind() → which authentication type the provider needs
# (ssh-key | gcp-wif | azure-oidc | token; omitted = none). The type, not
# the provider, drives the workflow's login step. A new provider with an existing
# type needs no workflow change (site-deploy.yml).
#
# Functions, not tasks: the adapter is reached via `rig deploy`/`rig running`, not
# via its own command surface per provider. Authentication is the caller's responsibility
# (the workflow's login step, the developer's agent/gcloud session).

RIG_PROVIDERS=()

# Per-service key: RIG_TARGET_<BASE>_<service>, with non-alphanumerics in
# the service name replaced by _ (compose allows '-', variable names do not).
deploy_svc_var() {   # deploy_svc_var <BASE> <service>
  local var
  var="RIG_TARGET_$1_$(printf '%s' "$2" | tr -c 'a-zA-Z0-9' '_')"
  eval "printf '%s' \"\${$var-}\""
}

deploy_targets_dir() { printf '%s\n' "$SITE_DIR/deploy/targets"; }

deploy_targets_list() {
  local f
  for f in "$(deploy_targets_dir)"/*.rig; do
    [ -f "$f" ] || continue
    f="${f##*/}"
    printf '%s\n' "${f%.rig}"
  done
}

# Reads the target file in two passes: LAX for the provider, then strict against the
# provider's own keys. A typo in a target file dies with the line pointed out, like rigfile.
deploy_load_target() {   # deploy_load_target <target>
  local t="$1" file v
  file="$(deploy_targets_dir)/$t.rig"
  if [ ! -f "$file" ]; then
    die "unknown target '$t' — declared targets: $(deploy_targets_list | tr '\n' ' ')(deploy/targets/<target>.rig)"
  fi
  # Reset before reading: the parser only sets keys that ARE in the file,
  # so without this a previous target's values leak into a target that lacks
  # the key (the stage root carries over to prod). Applies to the caller's environment too.
  for v in $(compgen -v RIG_TARGET_ 2>/dev/null || true); do
    unset "$v"
  done
  RIG_TARGET_PROVIDER=""
  LAX=1 rig_parse "$file" "RIG_TARGET_PROVIDER RIG_TARGET_SERVICES RIG_TARGET_DEPLOY_KEY_SECRET RIG_TARGET_STABLE_ONLY"
  [ -n "$RIG_TARGET_PROVIDER" ] \
    || die "$file: RIG_TARGET_PROVIDER is missing — which adapter deploys here? (${RIG_PROVIDERS[*]-none loaded})"
  has_word "$RIG_TARGET_PROVIDER" "${RIG_PROVIDERS[*]-}" \
    || die "$file: provider '$RIG_TARGET_PROVIDER' is not loaded (loaded: ${RIG_PROVIDERS[*]-none}) — add the plugin to RIG_MODULES"
  type "${RIG_TARGET_PROVIDER}_target_keys" >/dev/null 2>&1 \
    || die "provider '$RIG_TARGET_PROVIDER' lacks ${RIG_TARGET_PROVIDER}_target_keys — the plugin does not follow the provider contract (plugins/deploy/tasks.sh)"
  rig_parse "$file" "RIG_TARGET_PROVIDER RIG_TARGET_SERVICES RIG_TARGET_DEPLOY_KEY_SECRET RIG_TARGET_STABLE_ONLY $("${RIG_TARGET_PROVIDER}_target_keys")"
}

# Decision 2026-08-31 (site-release-ux §6): a target with RIG_TARGET_STABLE_ONLY=1
# (production target) only takes stable CalVer tags. A candidate or sha tag
# cannot end up there via the deploy button or the CLI. The check runs in both
# the plan and the deploy, so the rule applies regardless of entry path; the promote chain
# passes it trivially (it always sends the stable tag).
deploy_check_stable_only() {   # deploy_check_stable_only <target> <image|tag>
  [ "${RIG_TARGET_STABLE_ONLY-}" = 1 ] || return 0
  local tag="$2"
  case "$tag" in */*:*) tag="${tag##*:}" ;; esac
  printf '%s' "$tag" | grep -Eq '^[0-9]{4}\.[0-9]{2}\.[0-9]+$' \
    || die "the target '$1' only takes stable CalVer tags (RIG_TARGET_STABLE_ONLY=1) — '$tag' is not one; promote the candidate first (Actions → release)"
}

# Which services run on the loaded target: RIG_TARGET_SERVICES in the target file
# (a subset; stage may only run www), otherwise all declared.
deploy_target_services() {
  printf '%s\n' "${RIG_TARGET_SERVICES:-${RIG_DEPLOY_SERVICES-}}"
}

# <tag> → full image reference. A reference with '/' is used as is; a
# bare tag (sha-abc1234, 2026.08.3) is expanded against REGISTRY, the same
# environment variable that ci-push uses.
deploy_resolve_image() {   # deploy_resolve_image <service> <image|tag>
  case "$2" in
    */*) printf '%s\n' "$2" ;;
    *)
      [ -n "${REGISTRY-}" ] \
        || die "bare tag '$2' requires REGISTRY (REGISTRY=<registry> rig deploy ...) — or give the full image reference"
      printf '%s/%s-%s:%s\n' "$REGISTRY" "$RIG_SITE" "$1" "$2"
      ;;
  esac
}

doc deploy "Deploy a release to a target: rig deploy <target> <service> <image|tag>"
task::deploy() {
  local target="${1-}" svc="${2-}" ref="${3-}"
  [ -n "$target" ] && [ -n "$svc" ] && [ -n "$ref" ] \
    || die "usage: rig deploy <target> <service> <image|tag> — targets: $(deploy_targets_list | tr '\n' ' ')"
  if [ -n "${RIG_DEPLOY_SERVICES-}" ]; then
    has_word "$svc" "$RIG_DEPLOY_SERVICES" \
      || die "unknown service '$svc' — RIG_DEPLOY_SERVICES: $RIG_DEPLOY_SERVICES"
  fi
  local image
  image="$(deploy_resolve_image "$svc" "$ref")"
  deploy_load_target "$target"
  deploy_check_stable_only "$target" "$ref"
  has_word "$svc" "$(deploy_target_services)" \
    || die "the service '$svc' is not deployed to the target '$target' (RIG_TARGET_SERVICES: $(deploy_target_services))"
  "${RIG_TARGET_PROVIDER}_provider_deploy" "$target" "$svc" "$image"
}

doc running "What runs on a target right now (asks the provider): rig running <target> [service]"
task::running() {
  local target="${1-}" svc="${2-}" s
  [ -n "$target" ] \
    || die "usage: rig running <target> [service] — targets: $(deploy_targets_list | tr '\n' ' ')"
  deploy_load_target "$target"
  local list="${svc:-$(deploy_target_services)}"
  [ -n "$list" ] || die "no service given and RIG_DEPLOY_SERVICES is empty"
  for s in $list; do
    "${RIG_TARGET_PROVIDER}_provider_running" "$target" "$s"
  done
}

# The deploy plan is the workflow's only source of knowledge: site-deploy.yml asks
# the rig which rows to run (targets × services, with image and auth type
# per row) and runs them. It computes nothing itself. A bare tag requires REGISTRY,
# just like task::deploy.
doc deploy-plan "Deploy plan as JSON for the workflow matrix: rig deploy-plan <tag|image> [target ...]"
task::deploy-plan() {
  local tag="${1-}"
  [ -n "$tag" ] || die "usage: rig deploy-plan <tag|image> [target ...] — without targets: RIG_RELEASE_TARGETS"
  shift
  command -v jq >/dev/null 2>&1 || die "jq is missing — deploy-plan writes JSON"
  local targets="$*" t s auth rows=""
  targets="${targets//,/ }"   # the workflow input may be comma-separated
  [ -n "${targets// /}" ] || targets="${RIG_RELEASE_TARGETS-}"
  [ -n "${targets// /}" ] \
    || die "no targets — give targets or set RIG_RELEASE_TARGETS in rigfile (the default targets for a release)"
  [ -n "${RIG_DEPLOY_SERVICES-}" ] || die "RIG_DEPLOY_SERVICES is empty — declare it in rigfile"
  for t in $targets; do
    deploy_load_target "$t"
    deploy_check_stable_only "$t" "$tag"
    auth=none
    if type "${RIG_TARGET_PROVIDER}_auth_kind" >/dev/null 2>&1; then
      auth="$("${RIG_TARGET_PROVIDER}_auth_kind")"
    fi
    for s in $(deploy_target_services); do
      # key_secret: which repo secret carries the target's private key for
      # ssh-key auth. Different hosts can have different keys (multi-target).
      rows="$rows$(jq -nc --arg t "$t" --arg s "$s" --arg p "$RIG_TARGET_PROVIDER" \
        --arg a "$auth" --arg i "$(deploy_resolve_image "$s" "$tag")" \
        --arg k "${RIG_TARGET_DEPLOY_KEY_SECRET:-DEPLOY_KEY}" \
        '{target: $t, service: $s, provider: $p, auth: $a, environment: $t, image: $i, key_secret: $k}')
"
    done
  done
  printf '%s' "$rows" | jq -sc .
}

# The promote flow (site-release.yml) asks the rig for the default targets instead
# of reading rigfile itself. If the deploy module is missing, the task does not exist, and
# the release ends at tag + GitHub Release.
doc release-targets "The default targets for a release (RIG_RELEASE_TARGETS from rigfile)"
task::release-targets() { printf '%s\n' "${RIG_RELEASE_TARGETS-}"; }

doc targets "List declared targets and their providers (deploy/targets/)"
task::targets() {
  local t provider
  if [ -z "$(deploy_targets_list)" ]; then
    echo "no targets declared — create deploy/targets/<target>.rig with RIG_TARGET_PROVIDER=<provider>"
    return 0
  fi
  for t in $(deploy_targets_list); do
    provider="$(sed -nE 's/^[[:space:]]*RIG_TARGET_PROVIDER[[:space:]]*=[[:space:]]*//p' "$(deploy_targets_dir)/$t.rig" | head -1)"
    printf '  %-20s %s\n' "$t" "${provider:-⚠️  RIG_TARGET_PROVIDER is missing}"
  done
}

# Doctor: the whole chain target → provider → keys is validated without deploying.
# The miswiring should show on the developer's machine, not in the production deploy.
RIG_DOCTOR+=(deploy-doctor)

doc deploy-doctor "Doctor checks for deploy targets (file, provider, keys)"
task::deploy-doctor() {
  local t out ok=1
  for t in $(deploy_targets_list); do
    if out="$( (deploy_load_target "$t") 2>&1 )"; then
      echo "  ✅ target $t"
    else
      ok=0
      echo "  ❌ target $t: $out"
    fi
  done
  for t in ${RIG_RELEASE_TARGETS-}; do
    if [ ! -f "$(deploy_targets_dir)/$t.rig" ]; then
      ok=0
      echo "  ❌ RIG_RELEASE_TARGETS: '$t' has no deploy/targets/$t.rig"
    fi
  done
  [ "$ok" = 1 ] || return 1
}
