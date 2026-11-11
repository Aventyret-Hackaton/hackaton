# ci — build/push release images (the CI path through the Dockerfiles' stages).
#
# Cloud-neutral build contract: no $GITHUB_* assumptions; the calling workflow
# maps the provider's context to arguments. GCP onboarding lives in the gcloud plugin.
#
# Helper functions are prefixed ci_, the plugin's private surface. Only task::
# names are global (and protected against duplicates).

# Which runtime builds the service? The compose file's build.context is the only
# source; no mapping is maintained here. Under the payload (.rig/plugins/<p>/docker/<svc>
# → plugins/<p>/docker/<svc>) or, for a site-owned Dockerfile with the rig's
# stages, a path in the site (build.context: ingest). A service without build:
# is looked up as docker/<svc> in the loaded plugins. With ref, compose is read
# from the git tree so ci-digest is ref-correct.
ci_runtime() {   # ci_runtime <service> [ref]
  local svc="$1" ref="${2-}" ctx d
  if [ -z "$ref" ]; then
    ctx="$(rig_compose context "$svc" 2>/dev/null || true)"
  else
    ctx="$(ci_compose_at "$ref" context "$svc")"
  fi
  case "$ctx" in
    '') ;;
    *.rig/*)
      ctx="${ctx#*.rig/}"
      printf '%s\n' "${ctx%/}"
      return
      ;;
    *)
      ctx="${ctx#./}"
      printf '%s\n' "${ctx%/}"
      return
      ;;
  esac
  for d in "$RIG_DIR"/plugins/*/docker/"$svc"; do
    if [ -d "$d" ]; then
      printf '%s\n' "${d#$RIG_DIR/}"
      return
    fi
  done
  die "no runtime found for the service '$svc'"
}

# Site-owned runtime? Everything not under the payload (plugins/...).
# Site paths resolve against the site root, not against RIG_DIR.
ci_runtime_is_site() {   # ci_runtime_is_site <runtime>
  case "$1" in
    plugins/*) return 1 ;;
    *) return 0 ;;
  esac
}

# The runtime directory on disk. Payload runtimes under RIG_DIR, site-owned under
# the site root (without a leading ../ or ./).
ci_runtime_dir() {   # ci_runtime_dir <runtime>
  local rt="$1"
  case "$rt" in
    /*) printf '%s\n' "$rt" ;;
    plugins/*) printf '%s/%s\n' "$RIG_DIR" "$rt" ;;
    *) rt="${rt#../}"; rt="${rt#./}"; printf '%s/%s\n' "$SITE_DIR" "$rt" ;;
  esac
}

# The app source directory (label rig.src in compose, otherwise ./<service>). With
# ref, the compose file is read from the git tree so ci-digest is ref-correct.
ci_context() {   # ci_context <service> [ref]
  local svc="$1" ref="${2-}" src
  if [ -z "$ref" ]; then
    rig_compose_src "$svc"
    return 0
  fi
  src="$(ci_compose_at "$ref" label "$svc" rig.src)"
  printf '%s\n' "${src:-$svc}"
}

# The compose reader against a git ref instead of the working tree.
ci_compose_at() {   # ci_compose_at <ref> <query> [args...]
  local ref="$1" f
  shift
  for f in compose.yaml compose.yml docker-compose.yml docker-compose.yaml; do
    git cat-file -e "$ref:./$f" 2>/dev/null || continue
    git show "$ref:./$f" | "$RIG_DIR/scripts/rig-compose.sh" -f - "$@" 2>/dev/null || true
    return 0
  done
}

# The layer cache is not a choice: if there is a registry (REGISTRY), the
# main cache is always read. On a GitHub runner (gha environment exposed by
# ghaction-github-runtime) the gha cache is added. With neither, the build is
# cold.
#
# Only a build with RIG_CI_CACHE_SCOPE (e.g. main) writes, to that scope. A PR
# leaves it unset: COPY of the app tree invalidates every layer after deps, so
# a PR export (mode=max, ~500 MB) only saved the deps layer on the next push,
# and cost more than it saved (vi-se: 86 of 228 s). ignore-error on the
# export: the cache write must never fail a build.
ci_cache_args() {
  local scope="$RIG_SITE-$1"
  local write="${RIG_CI_CACHE_SCOPE-}"
  # hotfix/x is a ref name, not a valid tag.
  write="${write//\//-}"
  local ref_main="${REGISTRY-}/$RIG_SITE-$1:buildcache-main"
  local ref_write="${REGISTRY-}/$RIG_SITE-$1:buildcache-$write"
  if [ -n "${REGISTRY-}" ]; then
    printf '%s ' "--cache-from" "type=registry,ref=$ref_main"
    if [ -n "$write" ] && [ "$ref_write" != "$ref_main" ]; then
      printf '%s ' "--cache-from" "type=registry,ref=$ref_write"
    fi
    if [ -n "$write" ]; then
      printf '%s ' "--cache-to" "type=registry,ref=$ref_write,mode=max,ignore-error=true"
    fi
  fi
  if [ -n "${ACTIONS_CACHE_URL-}${ACTIONS_RESULTS_URL-}" ]; then
    printf '%s ' "--cache-from" "type=gha,scope=$scope"
    if [ -z "${REGISTRY-}" ] && [ -n "$write" ]; then
      printf '%s ' "--cache-to" "type=gha,mode=max,scope=$scope"
    fi
  fi
}

# Prebuilt base image: the tag is the content hash of the runtime directory.
# Empty RIG_BASE_REGISTRY turns it off; base is built locally as before.
ci_base_arg() {
  local img
  img="$("$RIG_DIR/scripts/rig-base-image.sh" "$(ci_runtime_dir "$1")" "${RIG_BASE_REGISTRY-ghcr.io/aventyret}" 2>/dev/null || true)"
  if [ -n "$img" ]; then
    printf '%s ' "--build-arg" "RIG_BASE_IMAGE=$img"
  fi
}

# Site deviations (EXTRA_* build args in the site's compose) must also apply to
# CI builds, which do not go through compose. rig-compose.sh extracts them; with
# ref, the compose file is read from the git tree so ci-digest is ref-correct.
ci_extra_args() {
  local svc="$1" ref="${2-}"
  if [ -z "$ref" ]; then
    rig_compose build-args "$svc" EXTRA_ 2>/dev/null || true
    return 0
  fi
  ci_compose_at "$ref" build-args "$svc" EXTRA_
}

# What make forced us to write four times, written once. Secrets are taken from
# the environment as BuildKit secrets. They never end up in an image layer.
ci_buildx() {
  local target="$1" svc="$2" runtime args kv
  shift 2
  runtime="$(ci_runtime "$svc")"
  args=(--file "$(ci_runtime_dir "$runtime")/Dockerfile" --target "$target" --build-context "app=$(ci_context "$svc")")
  if [ -n "${NPM_TOKEN-}" ]; then
    args=("${args[@]}" --secret id=npm_token,env=NPM_TOKEN)
  fi
  # COMPOSER_AUTH_SITE is the site's secret COMPOSER_AUTH (licenses such as ACF Pro
  # without auth.json in the repo). It is merged on top of the workflow's github-oauth;
  # the site's keys win on conflict.
  if [ -n "${COMPOSER_AUTH_SITE-}" ]; then
    COMPOSER_AUTH="$(printf '%s\n%s\n' "${COMPOSER_AUTH:-{\}}" "$COMPOSER_AUTH_SITE" | jq -cs '.[0] * .[1]')" \
      || die "COMPOSER_AUTH_SITE is not valid JSON"
    export COMPOSER_AUTH
  fi
  if [ -n "${COMPOSER_AUTH-}" ]; then
    args=("${args[@]}" --secret id=composer_auth,env=COMPOSER_AUTH)
  fi
  # while|read would have run in a subshell and lost the args appends; values can
  # contain spaces, so word-splitting $(…) does not work either.
  while IFS= read -r kv; do
    [ -n "$kv" ] && args=("${args[@]}" --build-arg "$kv")
  done <<EOF
$(ci_extra_args "$svc")
EOF
  args=("${args[@]}" $(ci_base_arg "$runtime") $(ci_cache_args "$svc") "$@" "$(ci_runtime_dir "$runtime")")
  docker buildx build "${args[@]}"
}

ci_usage() {
  [ -n "${2-}" ] || die "usage: rig $1 <service> <tag>"
}

# shasum (perl) exists on both macOS and GitHub runners; sha256sum as fallback.
ci_sha() {
  if command -v shasum >/dev/null; then
    shasum -a 256
  else
    sha256sum
  fi
}

doc ci-services "Print deployable services (source for the workflow matrix)"
task::ci-services() {
  printf '%s\n' "${RIG_DEPLOY_SERVICES-}"
}

ci_environments() {
  local envs="${RIG_ENVIRONMENTS:-dev stage prod}"
  case "$envs" in
    'dev stage prod' | 'dev prod') printf '%s\n' "$envs" ;;
    *) die "RIG_ENVIRONMENTS must be 'dev stage prod' or 'dev prod' (got '$envs')" ;;
  esac
}

ci_artifact() {
  local art="${RIG_ARTIFACT:-image}"
  case "$art" in
    image | files) printf '%s\n' "$art" ;;
    *) die "RIG_ARTIFACT must be 'image' or 'files' (got '$art')" ;;
  esac
}

doc ci-environments "Print hosted environments (RIG_ENVIRONMENTS: 'dev stage prod' or 'dev prod')"
task::ci-environments() {
  ci_environments
}

doc ci-artifact "Print artifact delivery mode (RIG_ARTIFACT: image or files)"
task::ci-artifact() {
  ci_artifact
}

doc ci-digest "Content hash of the service's build input: rig ci-digest <service> [ref]"
task::ci-digest() {
  # The build input is fully determined by the app context's git tree + the runtime
  # directory's git tree (Dockerfile + config; the base image reference is itself
  # a hash of the runtime directory, see rig-base-image.sh). Same digest = same
  # image, so CI can skip builds and retag instead. git tree hash instead of
  # file hashing: free, and the context is always tracked in CI.
  [ -n "${1-}" ] || die "usage: rig ci-digest <service> [ref]"
  local svc="$1" ref="${2:-HEAD}" ctx rt extra runtime
  # ./ prefix = path relative to cwd (the site root), not the repo root.
  ctx="$(git rev-parse "$ref:./$(ci_context "$svc" "$ref")")"
  # The runtime is not in the site's git tree (.rig is a symlink to the
  # pinned version): a release tag is immutable, so pin + runtime path
  # identify the content. A path pin (local checkout) is hashed on disk.
  runtime="$(ci_runtime "$svc" "$ref")"
  # The runtime is in the site's git tree: .rig/ is a committed copy of the
  # pinned payload, and a site-owned runtime lives in the site. Tree hash at ref;
  # uncommitted (path pin during development) is hashed on disk.
  rt="$(git rev-parse "$ref:./$(ci_runtime_dir "$runtime" | sed "s|^$SITE_DIR/||")" 2>/dev/null)" \
    || rt="$(cd "$(ci_runtime_dir "$runtime")" && find . -type f ! -name .DS_Store -print0 | LC_ALL=C sort -z | xargs -0 cat | ci_sha | cut -c1-40)"
  # EXTRA_* args are build input (passed by ci_buildx) and must be in the hash,
  # otherwise an args change is retagged away as "the same build". Only when they
  # exist, so sites without deviations keep their digests.
  extra="$(ci_extra_args "$svc" "$ref")"
  if [ -n "$extra" ]; then
    printf 'c-%s\n' "$(printf '%s %s %s' "$ctx" "$rt" "$extra" | ci_sha | cut -c1-12)"
  else
    printf 'c-%s\n' "$(printf '%s %s' "$ctx" "$rt" | ci_sha | cut -c1-12)"
  fi
}

# The prod image's name, without tag. RIG_SITE comes from the rigfile, so the
# workflows ask here instead of rebuilding the name from repo variables.
ci_image() {
  printf '%s\n' "${REGISTRY:+$REGISTRY/}$RIG_SITE-$1"
}

doc ci-image "Print the prod image name without tag: rig ci-image <service>"
task::ci-image() {
  [ -n "${1-}" ] || die "usage: rig ci-image <service>"
  ci_image "$1"
}

doc ci-build "Build prod image: rig ci-build <service> <tag>"
task::ci-build() {
  ci_usage ci-build "${2-}"
  ci_buildx prod "$1" --tag "$(ci_image "$1"):$2"
}

doc ci-export "Export built prod application tree: rig ci-export <service> <tag> <out-dir>"
task::ci-export() {
  [ -n "${3-}" ] || die "usage: rig ci-export <service> <tag> <out-dir>"
  local svc="$1" tag="$2" out="$3" img cid workdir
  ci_runtime "$svc" >/dev/null
  img="$(ci_image "$svc"):$tag"
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    ci_buildx prod "$svc" --tag "$img" --load
  fi
  workdir="$(docker image inspect --format '{{.Config.WorkingDir}}' "$img")"
  workdir="${workdir:-/app}"
  mkdir -p "$out"
  cid="$(docker create "$img")"
  if ! docker cp "$cid:$workdir/." "$out/"; then
    docker rm -f "$cid" >/dev/null 2>&1 || true
    die "failed to export '$workdir' from '$img'"
  fi
  docker rm -f "$cid" >/dev/null
}

doc ci-push "Build+push prod image: rig ci-push <service> <tag> [extra-tags...]"
task::ci-push() {
  ci_usage ci-push "${2-}"
  [ -n "${REGISTRY-}" ] || die "REGISTRY must be set"
  local svc="$1" t args
  shift
  args=()
  for t in "$@"; do
    args=(${args[@]+"${args[@]}"} --tag "$(ci_image "$svc"):$t")
  done
  ci_buildx prod "$svc" "${args[@]}" --push
}

doc ci-build-dev "Build dev-warm image: rig ci-build-dev <service> <tag>"
task::ci-build-dev() {
  ci_usage ci-build-dev "${2-}"
  ci_buildx dev-warm "$1" --tag "${DEV_REGISTRY:+$DEV_REGISTRY/}$RIG_SITE-$1-dev:$2"
}

doc ci-push-dev "Build+push dev-warm image: rig ci-push-dev <service> <tag> [extra-tags...]"
task::ci-push-dev() {
  ci_usage ci-push-dev "${2-}"
  [ -n "${DEV_REGISTRY-}" ] || die "DEV_REGISTRY must be set"
  local svc="$1" t args
  shift
  args=()
  for t in "$@"; do
    args=(${args[@]+"${args[@]}"} --tag "$DEV_REGISTRY/$RIG_SITE-$svc-dev:$t")
  done
  ci_buildx dev-warm "$svc" "${args[@]}" --push
}

doc ci-retag-dev "Retag the dev image without a rebuild: rig ci-retag-dev <service> <source-tag> <target-tag>"
task::ci-retag-dev() {
  # Manifest retag in the registry (no pull/push of layers). Exit 1 if the
  # source tag does not exist; the caller falls back to ci-push-dev.
  [ -n "${3-}" ] || die "usage: rig ci-retag-dev <service> <source-tag> <target-tag>"
  [ -n "${DEV_REGISTRY-}" ] || die "DEV_REGISTRY must be set"
  local img="$DEV_REGISTRY/$RIG_SITE-$1-dev"
  docker buildx imagetools inspect "$img:$2" >/dev/null 2>&1 || return 1
  docker buildx imagetools create -t "$img:$3" "$img:$2"
}

# The CalVer naming layer (BRANCH_STRATEGY §8, 2026-10-20-ci-cd-boundary):
# every merge to main is RC-tagged (YYYY.MM.N-rc.M), and the promote resolves
# RC → stable. Pure Git (no GitHub API), so both GitHub Actions and Azure
# Pipelines use the exact same tasks. The tags must be fetched (fetch-depth: 0
# on the runner, git fetch --tags locally).

release_tags() {   # release_tags <extended regex> — the repo's tags that match
  git tag --list | grep -E "$1" || true
}

# Version order without sort -V (missing in older BSD sort): numeric fields.
# 2026.08.3-rc.2 → "2026 08 3 2 <the tag>"; stable lacks the rc field (0).
release_sort() {
  awk -F'[.-]' '{ printf "%d %d %d %d %s\n", $1, $2, $3, (NF >= 5 ? $5 : 0), $0 }' \
    | sort -k1,1n -k2,2n -k3,3n -k4,4n | awk '{ print $5 }'
}

doc release-next-rc "Next RC tag (YYYY.MM.N-rc.M) from the repo's tags; main.yml tags the candidate"
task::release-next-rc() {
  local month n stable m
  month="$(date +%Y.%m)"
  # Next stable for the month: highest N + 1, otherwise .1. The candidate belongs to
  # the version not yet released.
  n="$(release_tags "^${month//./\\.}\\.[0-9]+$" | release_sort | tail -1)"
  n="${n##*.}"
  stable="$month.$(( ${n:-0} + 1 ))"
  # If candidates for the version already exist: the next sequence number. Tags are
  # never moved. A colliding run takes the next number instead.
  m="$(release_tags "^${stable//./\\.}-rc\\.[0-9]+$" | release_sort | tail -1)"
  m="${m##*.}"
  printf '%s-rc.%s\n' "$stable" "$(( ${m:-0} + 1 ))"
}

doc release-plan "The promote plan: rig release-plan [rc tag] → rc/stable/sha (empty = latest RC)"
task::release-plan() {
  local rc="${1-}" stable sha existing
  if [ -z "$rc" ]; then
    rc="$(release_tags '^[0-9]{4}\.[0-9]{2}\.[0-9]+-rc\.[0-9]+$' | release_sort | tail -1)"
    [ -n "$rc" ] \
      || die "no RC tags in the repo — merging to main creates them (main.yml); locally: git fetch --tags first"
  fi
  printf '%s' "$rc" | grep -Eq '^[0-9]{4}\.[0-9]{2}\.[0-9]+-rc\.[0-9]+$' \
    || die "'$rc' is not an RC tag (the format is YYYY.MM.N-rc.M, e.g. 2026.08.3-rc.2)"
  sha="$(git rev-parse --verify "refs/tags/$rc^{commit}" 2>/dev/null)" \
    || die "the RC tag '$rc' does not exist in the repo"
  stable="${rc%-rc.*}"
  # Stable on the same commit = an interrupted promote being rerun; let it through.
  # On another commit the release is out: the next merge gives the next version.
  if existing="$(git rev-parse --verify "refs/tags/$stable^{commit}" 2>/dev/null)"; then
    [ "$existing" = "$sha" ] \
      || die "the stable tag $stable already exists on another commit (${existing:0:7}) — that release is out; promote a later candidate"
  fi
  printf 'rc=%s\nstable=%s\nsha=%s\n' "$rc" "$stable" "$sha"
}

##############################################################################
## DOCTOR
#
# CI does not build through compose. ci_buildx assembles its own argument list
# and forwards only EXTRA_* args (ci_extra_args); ci_digest hashes only
# those. The prefix IS the mechanism. There is no list of allowed arguments, only
# the filter in rig-compose.sh. The consequence is that another build arg in the
# site's compose applies in dev and not in prod, silently, until the difference
# shows up as behavior in production (a site that sets PHP_VERSION gets its version
# locally and the rig's in the cloud).
#
# The check is the unwritten rule written out: EXTRA_* is the only path to CI.
# Warning and not error: a local argument may exist (a service that only runs
# locally is never built in CI), it just must not look like it applies to prod.
# Only the services in RIG_DEPLOY_SERVICES are built there, so a site below level
# delivery has nothing to diverge with and the check is silent.

# The line for one argument, as "<ok|warn>|<text>": the sentence differs
# depending on what the Dockerfile says. An arg whose value equals the
# Dockerfile's default does not diverge. It is redundant, not dangerous, and
# should not cry wolf. A declared arg with a DIFFERENT value applies locally and
# gets CI's default in prod. An undeclared one applies nowhere at all (docker
# complains about an arg no stage consumes). Without a runtime directory, only
# what is always true is said: the value does not carry over.
ci_doctor_arg_msg() {   # ci_doctor_arg_msg <runtime-dir> <arg> <value>
  local d
  if [ -z "$1" ] || [ ! -f "$1/Dockerfile" ]; then
    printf 'warn|build-arg %s applies only locally — CI passes only EXTRA_* args\n' "$2"
    return 0
  fi
  if ! grep -qE "^ARG $2(=|\$)" "$1/Dockerfile"; then
    printf 'warn|build-arg %s reaches nothing — the Dockerfile declares no ARG %s\n' "$2" "$2"
    return 0
  fi
  d="$(sed -nE "s/^ARG $2=(.*)\$/\1/p" "$1/Dockerfile" | head -1 | tr -d '"')"
  if [ -n "$d" ] && [ "$d" = "$3" ]; then
    printf 'ok|build-arg %s = the rig default (%s) — nothing diverges, but the line serves no purpose and will not go quiet if the rig changes its default\n' "$2" "$d"
  elif [ -n "$d" ]; then
    printf 'warn|build-arg %s applies only locally — CI builds with the Dockerfile default (%s)\n' "$2" "$d"
  else
    printf 'warn|build-arg %s applies only locally — CI builds without a value (ARG %s has no default)\n' "$2" "$2"
  fi
}

RIG_DOCTOR+=(ci-doctor)

doc ci-doctor "Doctor checks for the build contract (build args that do not reach CI)"
task::ci-doctor() {
  local svc kv k v rt rtdir lines line msg
  rig_dr_section "🏗  Build contract: build args vs CI..."
  # The validators die, so they run in a subshell and their message becomes the finding.
  if ! msg="$( (ci_environments) 2>&1)"; then
    rig_dr_fail "${msg#❌ }" "set RIG_ENVIRONMENTS in rigfile"
  fi
  if ! msg="$( (ci_artifact) 2>&1)"; then
    rig_dr_fail "${msg#❌ }" "set RIG_ARTIFACT in rigfile"
  fi
  if [ -z "${RIG_DEPLOY_SERVICES-}" ]; then
    rig_dr_ok "no service is built in CI (RIG_DEPLOY_SERVICES is empty) — build args cannot diverge"
    rig_dr_verdict
    return
  fi
  for svc in $RIG_DEPLOY_SERVICES; do
    # ci_runtime dies on a service without a runtime. Here that is no disaster,
    # just a thinner answer, so the subshell's exit code is swallowed.
    rt="$(ci_runtime "$svc" 2>/dev/null || true)"
    rtdir=""
    if [ -n "$rt" ]; then
      rtdir="$(ci_runtime_dir "$rt")"
    fi
    lines=""
    # Without a prefix, rig-compose prints ALL build args. $ values are skipped
    # with a line on stderr, silenced here. ci_extra_args skips them for the
    # same reason, so they are local for the same reason as the rest.
    while IFS= read -r kv; do
      k="${kv%%=*}"
      v="${kv#*=}"
      case "$k" in
        '' | EXTRA_*) continue ;;
        # CI sets RIG_BASE_IMAGE itself (ci_base_arg). A site value there is
        # a different error than this one and would only be noise in this line.
        RIG_BASE_IMAGE) continue ;;
      esac
      lines="$lines$(ci_doctor_arg_msg "$rtdir" "$k" "$v")
"
    done <<EOF
$(rig_compose build-args "$svc" 2>/dev/null)
EOF
    if [ -z "$lines" ]; then
      rig_dr_ok "$svc: no build args outside EXTRA_*"
      continue
    fi
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      case "$line" in
        ok\|*) rig_dr_ok "$svc: ${line#ok|}" ;;
        *) rig_dr_warn "$svc: ${line#warn|}" ;;
      esac
    done <<EOF
$lines
EOF
  done
  rig_dr_verdict
}
