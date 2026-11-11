# site — the site's lifecycle: everything you run daily, regardless of stack. Always
# loaded in a site (like plugin rig), so it is not an optional axis. A
# rig site always has a compose stack to start.
#
# rig_* helpers are the shared surface: site is always loaded, so other plugins may
# use them. Plugin-private helpers are prefixed with the plugin's name (F18).

##############################################################################
## HOST BASE — the site's *.test identity, worktree-aware
#
# The main checkout = RIG_SITE (www.<site>.test, regardless of branch), a linked
# git worktree = <site>-<branchslug> (www.<site>-<slug>.test, parallel
# environments, see the worktree plugin). The site's compose interpolates
# ${RIG_HOST_BASE} from .env (domains, router names, cert label); `rig env`
# writes it there. In a worktree COMPOSE_PROJECT_NAME is also set so
# containers, volumes and networks never collide with the main checkout's.
#
# A multisite site can have its own domains that are NOT derived from RIG_HOST_BASE,
# to mirror production's brand hosts (literals in compose, e.g.
# www.arenaide.test). ${RIG_WORKTREE_SUFFIX} exists for exactly those: empty on
# the main checkout, "-<slug>" in a worktree. Append it to the literal
# (www.arenaide${RIG_WORKTREE_SUFFIX}.test) so the main environment stays unchanged
# and a worktree still gets unique hosts/certs, without the literal ceasing to
# mirror prod on the main checkout.

# Branch/site name → DNS- and compose-friendly slug.
rig_slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

# The host base is a DNS label of its own (www.<base>.test), and DNS labels may be
# at most 63 characters. Long branch names otherwise give a domain the client refuses to resolve,
# long before rig or mkcert complains. Cut at 40 for readability and
# append a deterministic hash, so two long branches with the same prefix never
# collapse into the same environment. cksum, not shasum: available everywhere.
RIG_HOST_BASE_MAX=40

# $2 (optional) sets the budget, default RIG_HOST_BASE_MAX. rig_worktree_suffix()
# shares a DNS label with a brand name, not just the site name, and therefore
# cuts harder.
rig_host_cap() {
  local s="$1" max="${2:-$RIG_HOST_BASE_MAX}" hash
  [ "${#s}" -le "$max" ] && { printf '%s\n' "$s"; return 0; }
  hash="$(printf '%s' "$s" | cksum | cut -d' ' -f1)"
  hash="${hash: -6}"
  s="${s:0:$((max - 7))}"
  printf '%s-%s\n' "${s%%-}" "$hash"
}

rig_in_git() {
  git rev-parse --git-dir >/dev/null 2>&1
}

# Linked worktree ⇔ git-dir ≠ git-common-dir (the latter always points at
# the main checkout's .git).
rig_is_linked_worktree() {
  rig_in_git || return 1
  [ "$(git rev-parse --path-format=absolute --git-dir)" \
    != "$(git rev-parse --path-format=absolute --git-common-dir)" ]
}

# The branch slug, without the site name. Empty string on the main checkout. Shared by
# rig_host_base() and rig_worktree_suffix(), so the branch name is read only once.
rig_worktree_slug() {
  rig_is_linked_worktree || return 0
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
    rig_slugify "$(basename "$PWD")"
  else
    rig_slugify "$branch"
  fi
}

# The host base for the checkout in cwd. The main checkout keeps RIG_SITE regardless of
# branch. Your usual environment should not change domain when you switch branch.
rig_host_base() {
  local site slug
  site="$(rig_slugify "${1:-$RIG_SITE}")"
  [ -n "$site" ] || die "empty site name — RIG_SITE missing in rigfile"
  slug="$(rig_worktree_slug)"
  if [ -n "$slug" ]; then
    rig_host_cap "$site-$slug"
  else
    printf '%s\n' "$site"
  fi
}

# The suffix a literal domain (e.g. a multisite site's brand hosts, see
# HOST BASE above) appends to become worktree-unique: empty on
# the main checkout, "-<slug>" otherwise. Its own, shorter budget than RIG_HOST_BASE_MAX,
# since it shares its DNS label with a shorter name (a brand, not the site).
RIG_WORKTREE_SUFFIX_MAX=24

rig_worktree_suffix() {
  local slug
  slug="$(rig_worktree_slug)"
  [ -n "$slug" ] || return 0
  printf -- '-%s\n' "$(rig_host_cap "$slug" "$RIG_WORKTREE_SUFFIX_MAX")"
}

# The compose project name for the checkout in cwd: the prefix on every volume, network
# and container compose creates here. In a worktree `rig env` sets
# COMPOSE_PROJECT_NAME to the host base; the main checkout lets compose derive
# its default from the directory name, and then we must normalize the same way.
rig_compose_project() {
  if rig_is_linked_worktree; then
    rig_host_base
  else
    basename "$PWD" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]//g; s/^[_-]+//'
  fi
}

# The rig's only compose reader (scripts/rig-compose.sh): text-based, requires
# neither docker nor .env. The rationale is in the script's header. Everything that wants
# to know something from compose goes through this and nothing else.
rig_compose() {   # rig_compose <query> [args...]
  "$RIG_DIR/scripts/rig-compose.sh" "$@"
}

# The service's source directory in the site: the convention ./<service>, a deviating
# layout is declared as the label rig.src on the compose service (rig.src=apps/web).
# Compose is the source, as for runtime. The CI build (the app context), gcloud
# (.env.template) read the same answer.
rig_compose_src() {   # rig_compose_src <service>
  local src
  src="$(rig_compose label "$1" rig.src 2>/dev/null || true)"
  printf '%s\n' "${src:-$1}"
}

# The compose ↔ rigfile seam (F6): compose is the only source for service → runtime
# (build.context), rigfile for which plugins are loaded. Two errors: a context
# that does not exist on disk (moved runtime, otherwise fails incomprehensibly in
# docker), and a context whose plugin is not loaded (the fleet bug: the service
# is built but the role tasks are silently missing). Prints the problems one per line as
# "<context>|<error>|<fix>"; the caller decides whether it is ❌ (doctor) or die
# (setup, rig-update). Runs where the error arises, not on every command.
rig_seam_problems() {
  local ctxs ctx plugin dir kind key
  ctxs="$(rig_compose table 2>/dev/null | cut -d'|' -f2 | grep -E '^(\.rig|rigplugins)/' || true)"
  for ctx in $ctxs; do
    ctx="${ctx%/}"
    if [ ! -d "$ctx" ]; then
      printf '%s|build context does not exist on disk|missing .rig/? rig self setup. Moved runtime? MIGRATE_TO_RIG.md shows the current paths\n' "$ctx"
      continue
    fi
    case "$ctx" in
      .rig/plugins/*/docker/*) plugin="${ctx#.rig/plugins/}" ;;
      rigplugins/*/docker/*) plugin="${ctx#rigplugins/}" ;;
      *) continue ;;
    esac
    plugin="${plugin%%/*}"
    has_word "$plugin" "$RIG_LOADED" && continue
    key=RIG_MODULES
    if dir="$(plugin_dir "$plugin")"; then
      kind="$(rig_decl_value "$dir/plugin.rig" KIND 2>/dev/null || true)"
      [ "$kind" = stack ] && key=RIG_STACK
    fi
    printf "%s|the service is built here but the plugin '%s' is not loaded|add '%s' to %s in rigfile (otherwise the service exists but not its role tasks)\n" \
      "$ctx" "$plugin" "$plugin" "$key"
  done
}

# Hard error with all problems in the text, for setup and rig-update.
rig_seam_check() {
  local problems ctx what fix
  problems="$(rig_seam_problems)"
  [ -n "$problems" ] || return 0
  while IFS='|' read -r ctx what fix; do
    [ -n "$ctx" ] || continue
    printf '❌ compose: %s — %s\n   fix: %s\n' "$ctx" "$what" "$fix" >&2
  done <<EOF
$problems
EOF
  die "compose and rigfile disagree (see above)"
}

##############################################################################
## DEVELOPMENT

# The cert file is named after the FIRST domain in rig.hosts, and the container's own
# init.sh looks it up via `hostname`. Drift between the two gives no error
# output from compose, just a service without a cert on 443, which in turn
# kills e.g. WordPress' loopback calls.
rig_hosts_check() {
  local svc ctx img hostname hosts first
  while IFS='|' read -r svc ctx img hostname hosts; do
    [ -n "$svc" ] && [ -n "$hostname" ] && [ -n "$hosts" ] || continue
    first="${hosts%%,*}"
    [ "$hostname" = "$first" ] && continue
    printf "❌ compose: the service '%s' has hostname: %s but rig.hosts starts with %s.
" \
      "$svc" "$hostname" "$first" >&2
    printf '   The first entry in rig.hosts must be the hostname: it gives the cert slug the container init.sh looks up.
' >&2
    return 1
  done <<EOF
$(rig_compose table)
EOF
  return 0
}

doc dev "Restart the stack in the foreground: the log in the terminal, Ctrl-C stops everything"
task::dev() {
  need proxy-check
  docker compose down
  docker compose up
}

doc up "Start the stack in the foreground (Ctrl-C stops) — 'rig up -d' runs it in the background"
task::up() {
  need proxy-check
  docker compose up --force-recreate "$@"
}

doc down "Stop the stack"
task::down() {
  docker compose down
}

# The emergency exit from a broken environment: a corrupt volume is green in every
# declaration check, and the manual way out (hunting containers and volumes in
# Docker Desktop) is exactly what the rig should spare you. The teardown is cheap to
# undo: `down -v` never touches external volumes (rig-cert) and the golden db volume
# is not compose's (rig-seed-<site>, see the db plugin), so the database is cloned
# back in seconds instead of being reimported. The same teardown
# worktree-rm does for its environments, but for the checkout you are standing in.
doc prune "Tear down the environment: containers, networks and the project's volumes — the emergency exit when a volume is corrupt"
task::prune() {
  local proj vols reply
  proj="$(rig_compose_project)"
  vols="$(docker volume ls -q --filter "label=com.docker.compose.project=$proj" 2>/dev/null || true)"
  echo "This is torn down (the compose project '$proj'):"
  echo "   containers and networks"
  if [ -n "$vols" ]; then
    # shellcheck disable=SC2086
    printf '   volume: %s\n' $vols
  else
    echo "   (no volumes with the project's label — containers and networks are torn down anyway)"
  fi
  echo "Kept: the site's golden db volume (rig-seed-*) and the rig's shared volumes (rig-cert etc.)."
  if [ "${FORCE:-0}" != 1 ]; then
    [ -t 0 ] || die "no terminal to ask in — run 'FORCE=1 rig prune' if you are sure"
    printf 'Continue? [y/N] '
    read -r reply
    case "$reply" in
      y | Y | j | J | ja | yes) ;;
      *) die "aborted — nothing torn down" ;;
    esac
  fi
  docker compose down --volumes --remove-orphans
  # `down -v` only takes volumes that TODAY's compose declares. A volume
  # left over after a renamed volume key carries the project's label but is invisible
  # to compose. That is often exactly the corrupt one, so sweep those too.
  vols="$(docker volume ls -q --filter "label=com.docker.compose.project=$proj" 2>/dev/null || true)"
  if [ -n "$vols" ]; then
    # shellcheck disable=SC2086
    docker volume rm -f $vols >/dev/null
  fi
  log "✅ environment torn down — 'rig setup && rig up' builds it again (the database is cloned from the golden volume in seconds)"
}

# Follows only in a terminal. Without a tty (an agent, a pipe, CI) it prints
# and exits, otherwise 'rig logs www --tail 50' never finishes. -f follows anyway.
doc logs "Follow logs — optional service: rig logs www"
task::logs() {
  if [ -t 1 ]; then
    docker compose logs -f "$@"
  else
    docker compose logs "$@"
  fi
}

doc images "Build all images"
task::images() {
  docker compose build
  site_stamp_images
}

# The build context's content hash, same algorithm as rig-base-image.sh.
site_ctx_hash() {   # site_ctx_hash <directory>
  local sha=sha256sum
  command -v shasum >/dev/null && sha="shasum -a 256"
  (
    cd "$1" && find . -type f ! -name .DS_Store -print0 | LC_ALL=C sort -z \
      | while IFS= read -r -d '' f; do $sha "$f"; done \
      | $sha | cut -c1-12
  )
}

# The service's image name: image: if compose sets it, otherwise compose's default
# <project>-<service>. The project name is read from config, which evaluates here because
# the build just went through.
site_image_name() {   # site_image_name <service> <project>
  local image
  image="$(rig_compose image "$1")" || true
  printf '%s\n' "${image:-$2-$1}"
}

# The tag rig-ctx-<hash> on every vendored service's image. A fully cached
# build gives no new image and no new Created, so doctor cannot compare
# times; the tag says instead which context the image was last built from.
# Older rig-ctx tags on the repo are removed, otherwise they keep old images alive.
# An image a container is running cannot be untagged; it keeps its tag until
# the next 'rig images', and doctor can then say that the container runs an older runtime.
site_stamp_images() {
  local ctxs ctx svc project image repo hash old
  ctxs="$(rig_compose table | cut -d'|' -f2 | grep -E '^(\.rig|rigplugins)/' | sort -u)" || true
  [ -n "$ctxs" ] || return 0
  project="$(docker compose config --format json 2>/dev/null | sed -n 's/^  "name": "\([^"]*\)".*/\1/p' | head -1)" || true
  [ -n "$project" ] || return 0
  for ctx in $ctxs; do
    ctx="${ctx%/}"
    [ -d "$ctx" ] || continue
    svc="${ctx##*/}"
    image="$(site_image_name "$svc" "$project")"
    # Strip the tag, but not a registry port (host:5000/name).
    repo="$image"
    case "${image##*:}" in */*) ;; *) [ "${image%:*}" = "$image" ] || repo="${image%:*}" ;; esac
    docker image inspect "$image" >/dev/null 2>&1 || continue
    hash="$(site_ctx_hash "$ctx")"
    for old in $(docker image ls --format '{{.Repository}}:{{.Tag}}' "$repo" | grep ':rig-ctx-'); do
      docker image rm "$old" >/dev/null 2>&1 || true
    done
    docker image tag "$image" "$repo:rig-ctx-$hash"
  done
}

# The escape hatch, explicit (CLI API 2026-09-01, replaced implicit passthrough):
# the same pattern as `rig logs <service>`, verb first, the service as argument.
# Starts the service first, just like the exec tasks do via `need <role>-up`.
# No output to stdout: exec is piped (`rig exec www cat x.json | jq`).
doc exec "Run a command in a service's container: rig exec <service> <command...>"
task::exec() {
  [ $# -ge 2 ] || die "usage: rig exec <service> <command...>"
  local svc="$1"
  shift
  "$RIG_DIR/scripts/rig-compose.sh" services 2>/dev/null | grep -qx "$svc" \
    || die "unknown service '$svc' — services: $("$RIG_DIR/scripts/rig-compose.sh" services 2>/dev/null | tr '\n' ' ')"
  docker compose up -d "$svc"
  docker compose exec "$svc" "$@"
}

##############################################################################
## ENV
#
# op:// is resolved by `op inject` (1Password), rig:// and rig-secret:// by
# rig-env.sh against .env.rig in the repo root (the local environment's answer; the same
# references are resolved against the Cloud Run environment by `rig gcloud-env`).

# op inject only when the template actually references 1Password. Without op:// lines
# (contract level, fixture sites, CI) `rig env` should not require op to exist
# or be signed in. The plugin's private surface (F18): site_...
#
# `op inject < file` does NOT work: op only reads stdin when it is a pipe,
# not a file redirect ("expected data on stdin but none found"). Hence cat.
site_op_inject() {
  if grep -q "op://" "$1"; then
    command -v op >/dev/null 2>&1 \
      || die "$1 references op:// but the 1Password CLI (op) is missing — brew install --cask 1password-cli"
    cat "$1" | op inject
  else
    cat "$1"
  fi
}

doc env "Generate .env from .env.template (1Password + .env.rig + gh auth)"
task::env() {
  mkdir -p .user
  # rig-env.sh expands ${RIG_HOST_BASE} in the .env.rig answers from the ENVIRONMENT, so it
  # must be exported before the first injection (core.mk did it at parse level
  # with `export RIG_HOST_BASE`). Lazy: only here, not on every rig call.
  if [ -n "${RIG_SITE:-}" ]; then
    RIG_HOST_BASE="$(rig_host_base)"
    RIG_WORKTREE_SUFFIX="$(rig_worktree_suffix)"
    export RIG_HOST_BASE RIG_SITE RIG_WORKTREE_SUFFIX
  fi
  echo "injecting .env.template → .env (op:// + rig://)"
  # Atomic: `... > .env` truncates the file BEFORE op has succeeded, so a
  # signed-out 1Password left the site without env. Write to temp and move.
  local tmp
  tmp="$(mktemp -t rig-env.XXXXXX)"
  if ! site_op_inject .env.template \
      | "$RIG_DIR/scripts/rig-env.sh" inject --op-template .env.template > "$tmp"; then
    rm -f "$tmp"
    die "could not generate .env (op inject / rig-env.sh failed) — .env is untouched"
  fi
  mv "$tmp" .env
  # Command substitution in a printf argument does not trigger set -e: a
  # signed-out gh silently gave NPM_TOKEN= and the error showed up first as a 401 in pnpm.
  local gh_token
  gh_token="$(gh auth token 2>/dev/null || true)"
  [ -n "$gh_token" ] \
    || die "gh is not signed in — NPM_TOKEN and COMPOSER_AUTH need a token: rig github auth"
  {
    printf 'NPM_TOKEN=%s\n' "$gh_token"
    printf 'COMMIT_HASH=%s\n' "$(git rev-parse --short HEAD)"
    printf 'COMPOSER_AUTH=%s\n' "'{\"github-oauth\": {\"github.com\": \"$gh_token\"}}'"
  } >> .env
  if [ -n "${RIG_SITE:-}" ]; then
    printf 'RIG_HOST_BASE=%s\n' "$RIG_HOST_BASE" >> .env
    printf 'RIG_WORKTREE_SUFFIX=%s\n' "$RIG_WORKTREE_SUFFIX" >> .env
    if rig_is_linked_worktree; then
      printf 'COMPOSE_PROJECT_NAME=%s\n' "$RIG_HOST_BASE" >> .env
    fi
  fi
  local file app_dir out
  for file in */.env.template; do
    [ -f "$file" ] || continue
    app_dir="$(dirname "$file")"
    echo "injecting $file → $app_dir/.env (op:// + rig://)"
    out="$(site_op_inject "$file")" || die "op inject failed for $file"
    out="$(printf '%s\n' "$out" | "$RIG_DIR/scripts/rig-env.sh" inject --op-template "$file")" \
      || die "rig-env.sh failed for $file"
    {
      printf '# ## AUTOGENERATED BY rig env\n\n'
      printf '%s\n' "$out"
    } | tee "$app_dir/.env" > "$app_dir/.env.local"
    if [ -e "$app_dir/.npmrc.template" ]; then
      cp "$app_dir/.npmrc.template" "$app_dir/.npmrc"
    fi
  done
}

doc github-auth "Sign in to the GitHub CLI with packages scope"
task::github-auth() {
  gh auth login --scopes write:packages
}

##############################################################################
## AGGREGATES
#
# The registries are filled by the plugins' task files when they load. The same principle as
# RIG_*_TARGETS += in make, but an array append instead of
# parse-time accumulation.

doc setup "Full first-time setup of the site"
task::setup() {
  rig_seam_check
  need env
  need images
  need install
  # RIG_BUILD except roles with SETUP_BUILD=no: a dev server that compiles on
  # demand (next dev) needs no production build. `rig build` runs them all.
  local t
  for t in ${RIG_BUILD[@]+"${RIG_BUILD[@]}"}; do
    if has_word "$t" "$RIG_SETUP_NO_BUILD"; then
      continue
    fi
    need "$t"
  done
  # Fan-out over RIG_SEED: every database the site has gets data, not just the
  # primary one. A site with two databases (techsverige) should have a complete environment
  # after setup. An empty second database is nothing anyone wants to troubleshoot.
  # The loop and not `need seed`: `seed` is not a bare verb (RIG_FANOUT says
  # why). Site-specific ordering after the seeding stays in RIG_SETUP.
  for t in ${RIG_SEED[@]+"${RIG_SEED[@]}"}; do
    need "$t"
  done
  for t in ${RIG_SETUP[@]+"${RIG_SETUP[@]}"}; do
    need "$t"
  done
}

# install, build and format: the bodies are the same loop over their registry, so
# the runner generates them from RIG_FANOUT. The call is here and not in the runner
# so that the owner becomes this plugin. `rig where install` points at this
# file, and the verbs exist only in a site, as before.
load_fanout

##############################################################################
## THE IMAGE CONTRACT — the verbs live in the image (docs/decisions/2026-09-02-image-contract.md)
#
# The runner generates `rig <service> <verb>` from VERBS= in the manifest; the bodies are
# /rig/verbs/<verb> in the service's image. The akka-tools rule: install in a fresh
# container (`run --rm`: works cold, does not compete with the dev server over
# node_modules), the rest `exec` in the running one (same volumes, warm caches).
# 126/127 = the script is not in the image: almost always an image built before
# the update. Say so, instead of docker's "exec failed".

rig_verb_run() {   # rig_verb_run <run|exec> <service> <namespace> <verb> [arg…]
  local mode="$1" svc="$2" ns="$3" verb="$4" rc=0
  shift 4
  if [ "$mode" = run ]; then
    docker compose run --rm -e "RIG_VERB_NS=$ns" -e "RIG_VERB_SERVICE=$svc" "$svc" "/rig/verbs/$verb" "$@" || rc=$?
  else
    docker compose exec -e "RIG_VERB_NS=$ns" -e "RIG_VERB_SERVICE=$svc" "$svc" "/rig/verbs/$verb" "$@" || rc=$?
  fi
  case "$rc" in
    126 | 127)
      die "the image for $svc does not implement the verb '$verb' (/rig/verbs/$verb is missing) — was the image built before the update? Rebuild: rig images"
      ;;
  esac
  return "$rc"
}

# The doctor's container plane: the image writes the line protocol
#   ok|warn|fail<TAB>text<TAB>fix
# and the host translates to rig_dr_*. Formatting and verdict stay
# the host's. Never in a pipe: rig_dr_fail sets the flag in THIS shell.
rig_verb_doctor() {   # rig_verb_doctor <service> <namespace>
  local svc="$1" ns="$2" out rc=0 level text action tab
  tab="$(printf '\t')"
  rig_dr_section "🩺 $svc (the image's doctor)..."
  if ! rig_dr_state_ready || ! rig_dr_running "$svc"; then
    rig_dr_warn "$svc is not running — skipping ('rig up')"
    return 0
  fi
  out="$(docker compose exec -T -e "RIG_VERB_NS=$ns" -e "RIG_VERB_SERVICE=$svc" "$svc" /rig/verbs/doctor </dev/null 2>/dev/null)" || rc=$?
  case "$rc" in
    126 | 127)
      rig_dr_warn "$svc: the image lacks /rig/verbs/doctor — built before the update? 'rig images'"
      return 0
      ;;
  esac
  while IFS="$tab" read -r level text action; do
    case "$level" in
      ok) rig_dr_ok "$text" ;;
      warn) rig_dr_warn "$text${action:+ — $action}" ;;
      fail) rig_dr_fail "$text" "$action" ;;
      "") ;;
      *) rig_dr_warn "$svc: unknown line from the doctor verb: $level" ;;
    esac
  done <<EOF
$out
EOF
  rig_dr_verdict
}

# An empty registry is an error, not a silent green: `rig test` is the command CI
# calls, and "0 tests ran" must not look like "all tests passed".
doc test "Run the tests in all enabled plugins (the registry RIG_TEST)"
task::test() {
  local t
  if [ "${#RIG_TEST[@]}" = 0 ]; then
    die "no tests registered — a role registers its test task with RIG_TEST+=(<role>-test) (rigtasks.sh or the plugin's tasks.sh)"
  fi
  for t in ${RIG_TEST[@]+"${RIG_TEST[@]}"}; do
    need "$t"
  done
}

##############################################################################
## DOCTOR
#
# The doctor has two planes. The DECLARATION PLANE (files, names, registries, compose)
# can always run and is everything the doctor checked before. The RUNTIME PLANE asks the
# actual stack: the containers' state, the volumes' contents, the certs,
# the ingress and whether the site answers through the proxy.
#
# The reason the runtime plane exists: a broken volume is green in every
# declaration check. An empty node_modules volume shadowing the bind mount, a
# .next cache from before an upgrade, a datadir whose mysql user no
# longer matches .env. None of that shows in a file on the host, and the symptom is
# a 404 or a service restarting in a loop.
#
# The runtime check can only measure what is up, so the section skips
# itself with a line about why instead of reporting errors that only mean
# "nothing is running".
#
# rig_dr_* is shared surface: plugins contribute stack-specific checks via
# RIG_DOCTOR+=(<role>-doctor) and report in the same format.

RIG_DOCTOR_FAIL=0
RIG_DR_LINE="──────────────────────────────────────────────"

rig_dr_section() {
  echo "$RIG_DR_LINE"
  echo "$*"
}

rig_dr_ok() {
  echo "✅ $*"
}

rig_dr_warn() {
  echo "⚠️  $*"
}

# What the doctor cannot decide from here, e.g. because the answer requires permissions
# the developer does not have. Not a warning: there is nothing to fix in the site.
rig_dr_info() {
  echo "ℹ️  $*"
}

# The fix line is not decoration: the doctor must never report an error without
# saying what you type to get rid of it. The flag gives exit code 1 at
# the end. Without it neither CI nor an agent can trust the answer.
#
# NEVER called from a pipe (`... | while read`): the right-hand side of a pipe is a
# subshell and loses the flag. Loops over check results are therefore fed with
# `done <<EOF`, which runs in this shell.
rig_dr_fail() {
  echo "❌ $1"
  if [ -n "${2:-}" ]; then
    echo "   fix: $2"
  fi
  RIG_DOCTOR_FAIL=1
}

# The last line in a plugin doctor: turns the flag into an exit code, so that
# `rig www-doctor` on its own cannot print ❌ and still return 0. Inside
# `rig doctor` the hook is called with `|| true`. There the flag is counted once at
# the end instead, and an early 1 would have aborted the rest of the doctor (set -e).
rig_dr_verdict() {
  [ "$RIG_DOCTOR_FAIL" = 0 ]
}

# -T: the doctor is never interactive, and without the flag the exec dies when stdin
# is not a tty (CI, agents). </dev/null is not cosmetic: exec reads stdin,
# and a check running inside a `while read ... done <<EOF` loop then ate
# the rest of the loop's lines. The cert section went silent after the first service.
rig_dr_exec() {
  local svc="$1"
  shift
  docker compose exec -T "$svc" sh -c "$*" </dev/null
}

rig_dr_running() {
  [ "$(rig_dr_field "$1" 2)" = running ]
}

# curl writes "000" in %{http_code} when the connection never happened AND
# exits with an error code. An `|| echo 000` would therefore have given "000000".
rig_dr_http_code() {   # rig_dr_http_code <url>
  local code
  code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null)" || true
  printf '%s\n' "${code:-000}"
}

# The last log lines directly in the output: the error is almost always there, and
# the alternative is that the user has to guess which service to follow.
rig_dr_tail() {
  docker compose logs --no-color --tail 8 "$1" 2>/dev/null | sed 's/^/   │ /' || true
}

##############################################################################
## RUNTIME STATE
#
# One inspect call for the whole stack, cached in RIG_DR_STATE as lines:
#
#   service|status|restarts|health|exitcode|rig.hosts|networks|mounts|hostname
#
# The fields are read with awk instead of being stored in an associative array. Bash
# 3.2 has none. `docker inspect` and not `compose ps --format`: the template has been
# stable since forever and gives everything in one sweep, while compose has changed
# its format support several times.
#
# The mounts field is space-separated entries "type:name:target:rw:source".
# Paths with spaces would break it; no rig runtime has any, and
# the alternative (JSON without jq) is worse.

RIG_DR_STATE=""

rig_dr_load_state() {
  local ids
  ids="$(docker compose ps -aq 2>/dev/null)" || true
  if [ -z "$ids" ]; then
    return 1
  fi
  # shellcheck disable=SC2086
  RIG_DR_STATE="$(docker inspect --format \
    '{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Status}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}|{{.State.ExitCode}}|{{index .Config.Labels "rig.hosts"}}|{{range $n, $v := .NetworkSettings.Networks}}{{$n}},{{end}}|{{range .Mounts}}{{.Type}}:{{.Name}}:{{.Destination}}:{{.RW}}:{{.Source}} {{end}}|{{.Config.Hostname}}' \
    $ids 2>/dev/null)" || true
  [ -n "$RIG_DR_STATE" ]
}

# The plugin doctors are real tasks and also run directly (`rig www doctor`),
# and then nobody has loaded the state. Lazy, once per invocation.
rig_dr_state_ready() {
  if [ -z "$RIG_DR_STATE" ]; then
    rig_dr_load_state || return 1
  fi
  [ -n "$RIG_DR_STATE" ]
}

rig_dr_field() {   # rig_dr_field <service> <field number>
  printf '%s\n' "$RIG_DR_STATE" | awk -F'|' -v s="$1" -v f="$2" '$1 == s { print $f; exit }'
}

rig_dr_any_running() {
  printf '%s\n' "$RIG_DR_STATE" | awk -F'|' '$2 == "running" { found = 1 } END { exit !found }'
}

rig_dr_state_services() {
  printf '%s\n' "$RIG_DR_STATE" | awk -F'|' 'NF > 1 { print $1 }'
}

# Lines "service host [host ...]" from the containers' rig.hosts. The same source
# the proxy reads, so the list is by definition the one the proxy tries to route.
rig_dr_hosts() {
  printf '%s\n' "$RIG_DR_STATE" \
    | awk -F'|' 'NF > 1 && $6 != "" { print $1 " " $6 }' \
    | tr ',' ' '
}

# 64 hex characters = anonymous volume (Docker names them after their own ID).
rig_dr_is_anonymous() {
  [ "${#1}" = 64 ] && [ -z "$(printf '%s' "$1" | tr -d '0-9a-f')" ]
}

rig_dr_volume_for() {   # rig_dr_volume_for <service> <target in the container>
  printf '%s\n' "$(rig_dr_field "$1" 8)" | tr ' ' '\n' \
    | awk -F: -v d="$2" '$1 == "volume" && $3 == d { print $2; exit }'
}

##############################################################################
## THE MACHINE

# The machine's health (daemon, disk, the rig stack, *.test DNS, CA, address pools)
# is measured by rig proxy doctor (doctor.sh in the checkout), not here. One check, one
# place. The site's doctor runs it first so that one command is still enough. Without a
# checkout (a site without machine infra) it is skipped with a line about why.
rig_dr_machine() {
  rig_dr_section "🖥️  The machine (rig proxy doctor)..."
  if ! rig_machine_checkout >/dev/null 2>&1; then
    rig_dr_warn "no aventyret-rig checkout found — the machine check is skipped (set RIG=/path/to/aventyret-rig)"
    return 0
  fi
  if ! task::proxy-doctor; then
    RIG_DOCTOR_FAIL=1
  fi
}

##############################################################################
## DECLARATION CHECKS

# The keys in the template are the truth: `rig env` writes .env from it and only
# adds (NPM_TOKEN, COMMIT_HASH, RIG_HOST_BASE). A key that exists in
# the template but not in .env therefore means that .env was generated from an older
# template, and the env var the app reads is empty, which becomes a runtime error far
# from its cause.
rig_dr_env_keys() {   # rig_dr_env_keys <template> <generated>
  local tmpl="$1" env="$2" k missing=""
  for k in $(sed -nE 's/^([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' "$tmpl" | sort -u); do
    grep -qE "^$k=" "$env" || missing="$missing $k"
  done
  if [ -n "$missing" ]; then
    rig_dr_fail "$env is missing keys from $tmpl:$missing" "rig env"
  fi
}

# A reference left literally means that the injection did not go all the
# way (signed-out op, missing facet in .env.rig). The app then gets the string
# "op://..." as a password instead of an error.
#
# Only the VALUE SIDE of an assignment counts: the templates' comments explain
# the rig:// contract and come along into .env, and a check that counted them
# would have been red on every site.
rig_dr_env_refs() {   # rig_dr_env_refs <generated>
  local hits
  hits="$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=.*(^|[^A-Za-z-])(op|rig|rig-secret)://' "$1" 2>/dev/null || true)"
  if [ "${hits:-0}" != 0 ]; then
    rig_dr_fail "$1 has $hits unresolved op:// or rig:// reference(s)" \
      "rig env (check 'op whoami' and .env.rig)"
  fi
}

# Compose has TWO env_file parsers, and they are incompatible. The usual one
# (dotenv) trims the key, strips quotes and INTERPOLATES $ sequences in
# the value. An op-injected salt that happens to contain $ silently gets shorter.
# `format: raw` interprets nothing: quotes become part of the value, and a
# space around = is a hard parse error that stops the whole stack.
#
# Neither trap shows in the file, and both show up far from their cause:
# as a 401 from a service, or as "failed to parse env_file" when someone
# wrote dotenv syntax in a raw file. The check therefore reads the compose
# declaration and measures each file against the parser that actually applies to
# it, instead of having an opinion about which one should apply.
rig_dr_env_syntax() {   # rig_dr_env_syntax <file>
  local file="$1" fmts line key value trim val own k
  local ws="" quoted="" pad="" dollar=""
  fmts="$(rig_compose env-files 2>/dev/null \
    | awk -F'|' -v f="$file" '$1 == f { print ($2 == "" ? "dotenv" : $2) }')"
  # The file is not declared in compose. Then there is no parser to measure against.
  [ -n "$fmts" ] || return 0
  # The keys the file itself sets: `${WP_HOME}/wp` is intentional interpolation
  # and should not be flagged as a mangled value.
  own="$(sed -nE 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=.*/\1/p' "$file" | tr '\n' ' ')"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    key="${line%%=*}"
    value="${line#*=}"
    trim="$(printf '%s' "$key" | tr -d '[:space:]')"
    case "$key" in *[[:space:]]*) ws="$ws $trim" ;; esac
    case "$value" in
      \"?*\" | \'?*\') quoted="$quoted $trim" ;;
    esac
    # Only when the key is whole: `X = y` has whitespace on both sides of =, and
    # a single fix covers both. Two lines would just be noise.
    case "$key" in
      *[[:space:]]*) ;;
      *) case "$value" in ' '* | *' ' | '	'* | *'	') pad="$pad $trim" ;; esac ;;
    esac
    # Two forms are literal for dotenv: single quotes, and double quotes where $ is
    # escaped. An unquoted \$ does not help: the backslash becomes part of
    # the value and the $ sequence is expanded anyway. Alignment whitespace does
    # not count: dotenv trims it before stripping quotes, so `K = "…"` is
    # quoted. And a $ sequence pointing at a key in the same file is
    # intentional. Templates build compound values that way.
    val="${value#"${value%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    case "$val" in
      \'*\') ;;
      *'$'*)
        case "$val" in \"*\") val="${val//\\$/}" ;; esac
        for k in $own; do
          val="${val//\$\{$k\}/}"
          val="${val//\$$k/}"
        done
        case "$val" in *'$'*) dollar="$dollar $trim" ;; esac
        ;;
    esac
  done < "$file"
  case "$fmts" in
    *raw*)
      [ -z "$ws" ] || rig_dr_fail \
        "$file is read with format: raw and has whitespace around = :$ws — compose refuses to start the stack" \
        "write KEY=value without spaces"
      [ -z "$quoted" ] || rig_dr_warn \
        "$file (format: raw): the quotes become part of the value:$quoted — remove them"
      [ -z "$pad" ] || rig_dr_warn \
        "$file (format: raw): whitespace in the value is kept:$pad — remove it"
      ;;
  esac
  case "$fmts" in
    *dotenv*)
      [ -z "$dollar" ] || rig_dr_warn \
        "$file: \$ sequences in the value are interpolated away by compose:$dollar — quote the value in the template (\"…\" with escaped \\\$, the way 'rig env' writes it for op:// and rig://)"
      ;;
  esac
}

rig_dr_env() {
  local file app_dir
  rig_dr_section "🧬 Required .env files..."
  if [ -f .env ]; then
    rig_dr_ok ".env exists in the root"
    if [ -f .env.template ]; then
      rig_dr_env_keys .env.template .env
    fi
    rig_dr_env_refs .env
    rig_dr_env_syntax .env
  else
    rig_dr_fail ".env missing in the root" "rig env"
  fi
  for file in */.env.template; do
    [ -f "$file" ] || continue
    app_dir="$(dirname "$file")"
    if [ -f "$app_dir/.env" ]; then
      rig_dr_ok "found $app_dir/.env"
      rig_dr_env_keys "$file" "$app_dir/.env"
      rig_dr_env_refs "$app_dir/.env"
      rig_dr_env_syntax "$app_dir/.env"
    else
      rig_dr_fail "$app_dir/.env missing" "rig env"
    fi
  done
  if grep -qsE 'rig(-secret)?://' .env.template */.env.template 2>/dev/null; then
    if [ -f .env.rig ]; then
      rig_dr_ok ".env.rig exists (templates use rig:// references)"
    else
      rig_dr_fail ".env.rig missing — templates use rig://" "rig self update (scaffolds it)"
    fi
  fi
}


# Which compose files apply? If the site has the rig's overlay (compose.rig.yaml,
# docs/decisions/2026-10-10-compose-overlay.md) the runner sets COMPOSE_FILE so
# that docker compose and rig-compose.sh read the same list. If the variable is missing
# while the overlay exists, the site runs a runner older than the overlay: the stack
# starts without rig networks and certs and looks almost right, and the error shows nowhere
# else.
#
# On Podman the runner also appends the generated Podman overlay
# (docs/decisions/2026-10-16-podman-overlay.md). Without it, www-data in the rig
# images cannot write to the bind mounts.
rig_dr_compose_files() {
  rig_dr_section "📄 Compose files..."
  if [ "${RIG_ENGINE-}" = podman ]; then
    case "${COMPOSE_FILE-}" in
      */aventyret-rig/podman/*)
        rig_dr_ok "Podman overlay is read"
        ;;
      *)
        rig_dr_fail "Podman, but COMPOSE_FILE lacks the rig's Podman overlay — www-data cannot write to the bind mounts" \
          "clear COMPOSE_FILE from the environment and let the runner set it"
        ;;
    esac
  fi
  if [ ! -f compose.rig.yaml ]; then
    rig_dr_ok "no rig overlay — compose.yaml alone"
    return
  fi
  case "${COMPOSE_FILE-}" in
    *compose.rig.yaml*)
      rig_dr_ok "COMPOSE_FILE=$COMPOSE_FILE"
      ;;
    "")
      rig_dr_fail "compose.rig.yaml exists but COMPOSE_FILE is not set — the rig is older than the overlay" \
        "raise RIG_VERSION in rigfile to 2.25.0 or later and run 'rig self update'"
      ;;
    *)
      rig_dr_fail "COMPOSE_FILE=$COMPOSE_FILE lacks compose.rig.yaml — the rig's layer is not read" \
        "clear COMPOSE_FILE from the environment and let the runner set it"
      ;;
  esac
}

# The compose ↔ rigfile seam as a doctor section (rig_seam_problems above).
rig_dr_seam() {
  local problems ctx what fix
  rig_dr_section "🧵 Compose ↔ rigfile..."
  problems="$(rig_seam_problems)"
  if [ -z "$problems" ]; then
    rig_dr_ok "every vendored build context exists and its plugin is loaded"
    return 0
  fi
  while IFS='|' read -r ctx what fix; do
    [ -n "$ctx" ] || continue
    rig_dr_fail "$ctx: $what" "$fix"
  done <<EOF
$problems
EOF
}

# The contract in docs/ARCHITECTURE.md: every service in compose answers `up` and `cli`.
# The check lives here and not in the dispatch because it should fail at
# authoring time, not cost anything on every call. Same line as F7/F18.
# ⚠️ and not ❌: a site may have a sidecar without a shell, and then passthrough is
# the right answer. But it should be in the log, not invisible.
# The tasks are named <namespace>-<verb>, and the namespace is the service name with - and .
# as _ (load_instance/load_verbs in the runner; the hyphen is the separator between
# namespace and verb). The check must ask for the same name: statamic-db has
# statamic_db-up, and asking for statamic-db-up gave a false warning for
# every service with a hyphen.
rig_dr_vocabulary() {   # rig_dr_vocabulary <compose services>
  local svc ns missing
  rig_dr_section "🔤 Role vocabulary..."
  for svc in $1; do
    ns="$(printf '%s' "$svc" | tr '.-' '__')"
    missing=""
    is_task "$ns-up" || missing="$missing $ns-up"
    is_task "$ns-cli" || missing="$missing $ns-cli"
    if [ -z "$missing" ]; then
      rig_dr_ok "$svc: up + cli"
    else
      rig_dr_warn "$svc lacks$missing — 'rig $svc cli' falls through to passthrough"
    fi
  done
}

# The mirror check: a loaded role whose service does NOT exist in compose. Fleet had
# akka in .rig/ (compose points at its www runtime) and thereby got 16 cms-*
# tasks for a service the site does not have. It was discovered when five tasks
# were rewritten by hand. The source is the plugin's own runtimes: the directory name under
# docker/ IS the service name (service_for_runtime in rig.sh), not the plugin name.
rig_dr_mirror() {   # rig_dr_mirror <compose services with leading space>
  local svc_list="$1 " p pdir d role svc kind orphans="" unknown=""
  rig_dr_section "🪞 Loaded roles vs compose..."
  # The source is RIG_LOADED and not a glob over .rig/plugins/: in a vendored
  # site they coincide, but plugin_dir also looks in the site's rigplugins/,
  # and a glob would have reported plugins that lie on disk without being loaded.
  # Only roles (KIND stack|service) have runtimes that should have a service.
  # The machine plugins' (legacy/docker/attach) build something else.
  for p in $RIG_LOADED; do
    pdir="$(plugin_dir "$p")" || continue
    kind="$(rig_decl_value "$pdir/plugin.rig" KIND)"
    case "$kind" in
      stack|service) ;;
      *) continue ;;
    esac
    for d in "$pdir"/docker/*/; do
      [ -d "$d" ] || continue
      role="${d%/}"
      role="${role##*/}"
      has_word "$role" "$svc_list" || orphans="$orphans $role"
    done
  done
  if [ -z "$orphans" ]; then
    rig_dr_ok "every loaded role has a compose service"
  else
    rig_dr_warn "vendored runtimes without a compose service:$orphans"
    echo "   The tasks exist but have nothing to run in. Remove the stack from RIG_STACK,"
    echo "   or add the service to compose."
  fi
  # RIG_DEPLOY_SERVICES is a selection from compose (db, redis and migrate jobs
  # should not go to Cloud Run). But a name that does not exist in compose is
  # always a typo, and it is otherwise caught only in CI.
  if [ -n "${RIG_DEPLOY_SERVICES-}" ]; then
    for svc in $RIG_DEPLOY_SERVICES; do
      has_word "$svc" "$svc_list" || unknown="$unknown $svc"
    done
    if [ -z "$unknown" ]; then
      rig_dr_ok "RIG_DEPLOY_SERVICES exist in compose: $RIG_DEPLOY_SERVICES"
    else
      rig_dr_fail "RIG_DEPLOY_SERVICES names services that do not exist in compose:$unknown" \
        "fix the names in rigfile"
    fi
  fi
}

# External volumes are created by someone else (the rig, a one-off command). If
# one of them is missing, compose fails with "external volume not found" before anything starts,
# and that text does not say who owns the volume.
rig_dr_external_volumes() {
  rig_compose external-volumes
}

# Volumes labeled with a project name that starts with the site's name but is not
# this project: left behind after a removed worktree or a renamed
# directory. They are invisible (compose does not see them), eat disk, and a db volume
# among them is also an old database you might end up searching in.
rig_dr_stray_volumes() {
  local mine site stray
  mine="$(rig_compose_project)"
  site="$(rig_slugify "${RIG_SITE:-}")"
  [ -n "$site" ] || return 0
  stray="$(docker volume ls --format '{{.Name}}\t{{.Labels}}' 2>/dev/null \
    | awk -F'\t' -v site="$site" -v mine="$mine" '
        {
          p = $2
          if (p !~ /com\.docker\.compose\.project=/) next
          sub(/.*com\.docker\.compose\.project=/, "", p)
          sub(/,.*/, "", p)
          if (p != mine && index(p, site) == 1) print $1
        }')" || true
  if [ -n "$stray" ]; then
    rig_dr_warn "volumes from another compose project for the same site:"
    # shellcheck disable=SC2086
    printf '   │ %s\n' $stray
    echo "   Left over after a removed worktree or a renamed directory."
    echo "   Remove them when you know they are dead: docker volume rm <name>"
  fi
}

rig_dr_volumes_declared() {
  local v
  rig_dr_section "💾 Volumes (declared)..."
  for v in $(rig_dr_external_volumes); do
    if docker volume inspect "$v" >/dev/null 2>&1; then
      rig_dr_ok "external volume exists: $v"
    else
      case "$v" in
        rig-*) rig_dr_fail "external volume missing: $v" "rig proxy up (the rig's volumes are created there)" ;;
        *)     rig_dr_fail "external volume missing: $v" "docker volume create $v" ;;
      esac
    fi
  done
  rig_dr_stray_volumes
}

##############################################################################
## RUNTIME CHECKS

rig_dr_services_state() {   # rig_dr_services_state <compose services>
  local svc status restarts health code seen=""
  rig_dr_section "🚦 Service state..."
  for svc in $(rig_dr_state_services); do
    seen="$seen $svc"
    status="$(rig_dr_field "$svc" 2)"
    restarts="$(rig_dr_field "$svc" 3)"
    health="$(rig_dr_field "$svc" 4)"
    code="$(rig_dr_field "$svc" 5)"
    case "$status" in
      running)
        if [ "$health" = unhealthy ]; then
          rig_dr_fail "$svc: running but the healthcheck is red" "rig logs $svc"
          rig_dr_tail "$svc"
        elif [ "${restarts:-0}" != 0 ]; then
          # `restart: unless-stopped` hides a crashing service: it SHOWS
          # as running between the restarts, and the counter is the only trace.
          rig_dr_warn "$svc: running, but has restarted $restarts times — something dies and is restarted"
          rig_dr_tail "$svc"
        elif [ "$health" = "-" ]; then
          rig_dr_ok "$svc: running"
        else
          rig_dr_ok "$svc: running (health: $health)"
        fi
        ;;
      restarting)
        rig_dr_fail "$svc: restarting right now — start loop" "rig logs $svc"
        rig_dr_tail "$svc"
        ;;
      exited)
        # The exit code tells a stopped stack from a crashed one. `rig down` removes
        # the containers, so a container that STAYS as exited was
        # stopped by something: 0 and 143 (SIGTERM) are an orderly stop: a relative of `rig
        # down`, a restarted computer, a `docker compose stop`. 137
        # (SIGKILL) is the hard way, usually Docker Desktop shutting down
        # or the memory limit. Everything else is a crash and gets the log tail.
        case "$code" in
          0 | 143)
            rig_dr_warn "$svc: stopped (exit code $code) — 'rig up' starts it again"
            ;;
          137)
            rig_dr_warn "$svc: killed with SIGKILL (137) — 'rig up'. If it recurs: look at the memory limit in Docker Desktop"
            ;;
          *)
            rig_dr_fail "$svc: crashed (exit code $code)" "rig logs $svc, then 'rig up'"
            rig_dr_tail "$svc"
            ;;
        esac
        ;;
      dead)
        rig_dr_fail "$svc: dead — the container could not be stopped or removed" \
          "docker compose rm -f $svc, then 'rig up' — or tear down from scratch: rig prune"
        ;;
      created)
        rig_dr_warn "$svc: created but never started — 'rig up'"
        ;;
      paused)
        rig_dr_warn "$svc: paused — docker compose unpause $svc"
        ;;
      *)
        rig_dr_warn "$svc: unexpected state '$status'"
        ;;
    esac
  done
  for svc in $1; do
    has_word "$svc" " $seen " \
      || rig_dr_warn "$svc: exists in compose but has no container — 'rig up'"
  done
}

# The mounts from inside the container. This is the check that was missing: a named
# volume mounted OVER a directory in a bind-mounted source is invisible from
# the host. The host's www/node_modules can be full while the container's is empty.
#
# An empty volume is ⚠️ and not ❌: a cold cache is rightly empty. Which
# mounts must NEVER be empty only the stack's plugin knows, and those
# checks live there (RIG_DOCTOR). Not writable, however, is always ❌: then
# the app cannot build, whatever the volume is for.
rig_dr_mounts() {
  local svc
  rig_dr_section "📁 Mounts (from inside the containers)..."
  for svc in $(rig_dr_state_services); do
    rig_dr_running "$svc" || continue
    rig_dr_mounts_for "$svc"
  done
}

rig_dr_mounts_for() {   # rig_dr_mounts_for <service>
  local svc="$1" m kind name dest rw src paths="" out path verdict vol
  for m in $(rig_dr_field "$svc" 8); do
    kind="${m%%:*}"
    m="${m#*:}"
    name="${m%%:*}"
    m="${m#*:}"
    dest="${m%%:*}"
    m="${m#*:}"
    rw="${m%%:*}"
    src="${m#*:}"
    case "$kind" in
      bind)
        # Docker Desktop reports the bind source from the VM's view
        # (/host_mnt/Users/...) for some containers and as the host's own
        # path for others. Without the normalization every such bind became a
        # false "the source does not exist".
        src="${src#/host_mnt}"
        # A bind source that does not exist is created by Docker as an empty directory:
        # the result is not an error message but a service without code.
        if [ ! -e "$src" ]; then
          rig_dr_fail "$svc: the bind source $src does not exist (mounted at $dest)" \
            "fix the path in compose"
        elif [ -d "$src" ] && [ -z "$(ls -A "$src" 2>/dev/null | head -1)" ]; then
          rig_dr_fail "$svc: the bind source $src is empty but is mounted at $dest" \
            "wrong directory or incomplete checkout — check compose and 'git status'"
        fi
        ;;
      volume)
        [ "$rw" = true ] || continue
        if rig_dr_is_anonymous "$name"; then
          rig_dr_warn "$svc: anonymous volume at $dest — disappears on 'docker compose down -v' and cannot be found again. Declare it in compose if the contents matter."
          continue
        fi
        paths="$paths $dest"
        ;;
    esac
  done
  [ -n "$paths" ] || return 0
  # One exec per service, not per volume: every exec costs a few tenths of a second.
  out="$(rig_dr_exec "$svc" '
    for p in '"$paths"'; do
      if [ ! -d "$p" ]; then
        echo "$p missing"
      elif [ -z "$(ls -A "$p" 2>/dev/null | head -1)" ]; then
        echo "$p empty"
      elif touch "$p/.rig-doctor" 2>/dev/null; then
        rm -f "$p/.rig-doctor"
        echo "$p ok"
      else
        echo "$p readonly"
      fi
    done' 2>/dev/null)" || true
  if [ -z "$out" ]; then
    rig_dr_warn "$svc: could not read the mounts in the container (no shell?)"
    return 0
  fi
  while read -r path verdict; do
    [ -n "$path" ] || continue
    case "$verdict" in
      ok)
        rig_dr_ok "$svc: $path populated and writable"
        ;;
      empty)
        vol="$(rig_dr_volume_for "$svc" "$path")"
        rig_dr_warn "$svc: $path is empty — the volume shadows the directory with no contents (cold cache, or a volume that was never populated)"
        echo "   empty it and start over: rig down && docker volume rm ${vol:-<volume>} && rig up (the whole environment: rig prune)"
        ;;
      missing)
        rig_dr_warn "$svc: $path does not exist in the container although a volume is mounted there"
        ;;
      readonly)
        rig_dr_fail "$svc: $path is not writable for the container's user" \
          "check the ownership: docker compose exec $svc ls -ld $path"
        ;;
    esac
  done <<EOF
$out
EOF
}

# The cert from inside the container, with the container's OWN slug logic (config/init.sh):
# it looks up /rig/cert/sites/<hostname>.pem, otherwise the same without the first
# label. So the file existing in the volume is not enough. If `hostname:` is missing in
# compose the container's hostname is its container ID, and then init.sh finds
# nothing and binds only 8080. It does not show from outside: the proxy terminates
# TLS and the site answers 200 anyway, but container→container calls over https
# (WordPress' loopback) die.
#
# ⚠️ and not ❌ for a service that manages without internal 443. Which one that is
# only the stack's plugin knows, and there the loopback check is a ❌ (cms-doctor).
rig_dr_certs() {
  local svc hosts h host_first cname found
  rig_dr_section "🔐 Cert in the container (the rig-cert volume)..."
  while read -r svc hosts; do
    [ -n "$svc" ] || continue
    rig_dr_running "$svc" || continue
    host_first=""
    for h in $hosts; do
      host_first="$h"
      break
    done
    cname="$(rig_dr_field "$svc" 9)"
    # One exec, not one per candidate: the same loop as init.sh, run in
    # the container, which prints the slug it would have found.
    found="$(rig_dr_exec "$svc" '
      h="$(hostname)"
      for s in "$h" "${h#*.}"; do
        if [ -f "/rig/cert/sites/$s.pem" ]; then
          echo "$s"
          break
        fi
      done' 2>/dev/null)" || true
    if [ -n "$found" ]; then
      rig_dr_ok "$svc: cert for $cname (sites/$found.pem)"
    elif [ "$cname" != "$host_first" ]; then
      rig_dr_warn "$svc: the container's hostname is '$cname' but rig.hosts says $host_first — init.sh looks for sites/$cname.pem and finds nothing, so the service runs only HTTP on 8080"
      echo "   fix: set 'hostname: $host_first' on $svc in compose (the same value as the first entry in rig.hosts)"
    else
      rig_dr_warn "$svc: no cert for $cname in the rig-cert volume — the service runs only HTTP on 8080"
      echo "   fix: rig proxy cert"
    fi
  done <<EOF
$(rig_dr_hosts)
EOF
}

rig_dr_ingress() {
  local svc hosts h nets mine others ids hit
  rig_dr_section "🕸  Ingress (the rig network + host claims)..."
  mine="$(rig_compose_project)"
  while read -r svc hosts; do
    [ -n "$svc" ] || continue
    # Network membership is only meaningful for a running container.
    # The host claims below apply anyway: they compare labels, and a stopped site
    # whose host someone else has taken over is exactly what you want to know.
    rig_dr_running "$svc" || continue
    nets="$(rig_dr_field "$svc" 7 | tr ',' ' ')"
    if has_word rig "$nets"; then
      rig_dr_ok "$svc: on the rig network ($hosts)"
    else
      rig_dr_fail "$svc: has rig.hosts but is not on the network 'rig' — the proxy cannot reach it" \
        "add 'rig: {}' under networks: for $svc in compose"
    fi
  done <<EOF
$(rig_dr_hosts)
EOF

  # Two containers claiming the same host: Traefik picks one of them,
  # and which one depends on the start order. The symptom is that the site shows
  # another site's content, i.e. the thing you least of all suspect.
  ids="$(docker ps -q --filter label=rig.hosts 2>/dev/null)" || true
  if [ -n "$ids" ]; then
    # shellcheck disable=SC2086
    others="$(docker inspect --format \
      '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "rig.hosts"}}' \
      $ids 2>/dev/null | awk -F'|' -v mine="$mine" '$1 != mine { print $1 " " $2 }' | tr ',' ' ')" || true
    for h in $(rig_dr_hosts | cut -d' ' -f2-); do
      hit="$(printf '%s\n' "$others" \
        | awk -v h="$h" '{ for (i = 2; i <= NF; i++) if ($i == h) print $1 }' | sort -u | tr '\n' ' ')"
      hit="${hit% }"
      if [ -n "$hit" ]; then
        rig_dr_fail "the host $h is claimed by another project: $hit" \
          "stop the other site, or change RIG_SITE — otherwise Traefik picks one of them"
      fi
    done
  fi

  rig_dr_alias_leak
}

# The alias leak: compose adds the service name as an alias on EVERY network the service is
# on, including the shared rig network. So every running site answers to 'www'
# and 'cms' in there, and an internal URL like http://cms:8080 can round-robin
# to another site. The site's own aliases belong on the default network
# (${RIG_HOST_BASE}-cms).
#
# The check is silent until the site actually has such a URL in its env. Otherwise
# it would have warned on every site every time two sites are up at once.
rig_dr_alias_leak() {
  local ids shared name hit envs f
  ids="$(docker network inspect rig --format '{{range $k, $v := .Containers}}{{$k}} {{end}}' 2>/dev/null)" || true
  [ -n "$ids" ] || return 0
  envs=""
  for f in .env */.env; do
    [ -f "$f" ] && envs="$envs $f"
  done
  [ -n "$envs" ] || return 0
  # shellcheck disable=SC2086
  shared="$(docker inspect --format \
    '{{index .Config.Labels "com.docker.compose.project"}} {{range .NetworkSettings.Networks.rig.Aliases}}{{.}} {{end}}' \
    $ids 2>/dev/null \
    | awk '{ for (i = 2; i <= NF; i++) print $i, $1 }' \
    | sort -u | awk '{ c[$1]++ } END { for (a in c) if (c[a] > 1) print a }')" || true
  for name in $shared; do
    # shellcheck disable=SC2086
    hit="$(grep -lE "//$name([:/]|\$)" $envs 2>/dev/null | tr '\n' ' ')" || true
    hit="${hit% }"
    if [ -n "$hit" ]; then
      rig_dr_fail "the alias '$name' on the rig network is shared by several sites, and $hit points at it" \
        "point at \${RIG_HOST_BASE}-$name (project alias on the default network) in .env.rig instead"
    fi
  done
}

# The symptom check: does the site answer through the proxy? It replaces none of the checks
# above. It exists so that the error that remains after them always shows here.
rig_dr_http() {
  local svc hosts h code
  rig_dr_section "🌐 Through the proxy..."
  if ! command -v curl >/dev/null; then
    rig_dr_warn "curl missing — skipping the HTTP check"
    return 0
  fi
  if [ "$(docker container inspect -f '{{.State.Running}}' rig-proxy 2>/dev/null)" != true ]; then
    rig_dr_warn "rig-proxy is not running — skipping the HTTP check ('rig proxy up')"
    return 0
  fi
  while read -r svc hosts; do
    [ -n "$svc" ] || continue
    rig_dr_running "$svc" || continue
    for h in $hosts; do
      code="$(rig_dr_http_code "https://$h/")"
      case "$code" in
        2?? | 3?? | 401)
          rig_dr_ok "$h → $code"
          ;;
        502 | 503 | 504)
          rig_dr_fail "$h → $code: the proxy finds the route but the app does not answer in the container" \
            "rig logs $svc"
          ;;
        404)
          rig_dr_warn "$h → 404: either the app has no route on /, or the proxy does not know the host"
          echo "   Check the label rig.hosts and the host claims in the ingress section above."
          ;;
        000)
          rig_dr_fail "$h → no connection at all: DNS or the proxy" "rig proxy doctor"
          ;;
        *)
          rig_dr_warn "$h → $code"
          ;;
      esac
    done
  done <<EOF
$(rig_dr_hosts)
EOF
}

# An image built before its own build context changed. The context is vendored
# (.rig/plugins/<p>/docker/<role>), so a hit almost always means that
# the payload was updated without the image being rebuilt, and then the site runs on
# yesterday's runtime while the files on disk say something else.
#
# The tag from site_stamp_images decides when it exists. The time is a fallback for
# images built without it: a change that does not touch the built stage gives a
# fully cached build, and then the mtime warning remained after 'rig images'.
rig_dr_images() {
  local ctxs ctx svc image created ref hit tags
  rig_dr_section "🏗  Images vs the build context..."
  ctxs="$(rig_compose table | cut -d'|' -f2 | grep -E '^(\.rig|rigplugins)/' | sort -u)" || true
  if [ -z "$ctxs" ]; then
    rig_dr_ok "no vendored build contexts to compare"
    return 0
  fi
  ref="$(mktemp -t rig-doctor.XXXXXX)"
  for ctx in $ctxs; do
    ctx="${ctx%/}"
    [ -d "$ctx" ] || continue
    # The directory name under docker/ IS the service name (service_for_runtime).
    svc="${ctx##*/}"
    image="$(docker compose images -q "$svc" 2>/dev/null | head -1)" || true
    created=""
    if [ -n "$image" ]; then
      created="$(docker inspect --format '{{.Created}}' "$image" 2>/dev/null)" || true
    fi
    if [ -z "$created" ]; then
      rig_dr_warn "$svc: no built image to compare with ($ctx) — 'rig images'"
      continue
    fi
    tags="$(docker inspect --format '{{join .RepoTags " "}}' "$image" 2>/dev/null)" || true
    case " $tags " in
      *":rig-ctx-$(site_ctx_hash "$ctx") "*)
        rig_dr_ok "$svc: the image is built from the current $ctx"
        continue
        ;;
      *:rig-ctx-*)
        rig_dr_warn "$svc: the build context has changed since the image was built — the container runs an older runtime"
        echo "   fix: rig images, then 'rig up'"
        continue
        ;;
    esac
    # BSD and GNU touch both take ISO-8601 with -d; fractional seconds are cut off.
    if ! touch -d "${created%%.*}Z" "$ref" 2>/dev/null; then
      rig_dr_warn "$svc: could not parse the image timestamp ($created) — skipping"
      continue
    fi
    hit="$(find "$ctx" -type f -newer "$ref" -print 2>/dev/null | head -3)" || true
    if [ -n "$hit" ]; then
      rig_dr_warn "$svc: the build context is newer than the image — the container runs an older runtime"
      # shellcheck disable=SC2086
      printf '   │ %s\n' $hit
      echo "   fix: rig images, then 'rig up'"
    else
      rig_dr_ok "$svc: the image is built after $ctx"
    fi
  done
  rm -f "$ref"
}

##############################################################################
## THE DOCTOR TASK

doc doctor "Check that the local environment is intact"
task::doctor() {
  local services svc_list="" svc t
  RIG_DOCTOR_FAIL=0
  echo "🩺 Rig Doctor"
  rig_dr_machine
  if ! docker info >/dev/null 2>&1; then
    echo "$RIG_DR_LINE"
    echo "❌ Doctor stopped — without a daemon nothing else can be measured."
    return 1
  fi
  rig_dr_env
  rig_dr_compose_files

  # has_word matches spaces, compose prints one service per line.
  services="$(rig_compose services | sort)" || true
  for svc in $services; do
    svc_list="$svc_list $svc"
  done
  if [ -z "$services" ]; then
    rig_dr_warn "could not read the compose services from the compose file"
  else
    rig_dr_seam
    rig_dr_vocabulary "$services"
    # The mirror check compares AGAINST the compose list and is meaningless without it.
    rig_dr_mirror "$svc_list"
  fi

  rig_dr_volumes_declared

  if rig_dr_load_state; then
    rig_dr_services_state "$services"
    rig_dr_ingress
    if rig_dr_any_running; then
      rig_dr_mounts
      rig_dr_certs
      rig_dr_http
    else
      rig_dr_section "📁 The runtime in the containers..."
      rig_dr_warn "no service is running — mounts, certs and HTTP cannot be measured ('rig up')"
    fi
    rig_dr_images
  else
    rig_dr_section "🚦 The runtime..."
    rig_dr_warn "no containers for this project — the runtime checks are skipped"
    echo "   Volumes, certs, ingress and HTTP can only be measured on a stack that is up: 'rig up'"
  fi

  # Stack-specific checks (RIG_DOCTOR). The order is the load order,
  # i.e. the rigfile's.
  for t in ${RIG_DOCTOR[@]+"${RIG_DOCTOR[@]}"}; do
    # || true: the hook's exit code is its own verdict (rig_dr_verdict), and without
    # it the first red stack check would have aborted the rest of the doctor.
    need "$t" || true
  done

  echo "$RIG_DR_LINE"
  if [ "$RIG_DOCTOR_FAIL" != 0 ]; then
    echo "❌ Doctor found problems — the fixes are listed above."
    return 1
  fi
  echo "✅ Doctor done."
}
