# legacy — coexistence with akka-tools during the transition. Only ONE proxy can
# own 80/443 on the machine, so the rig proxy must be able to serve sites that have
# not migrated yet. Four things differ, all machine-local:
#
#   1. Ports      akka-proxy is stopped (and akka-dns/akka-cert where they exist).
#   2. Network    ingress containers are connected to the rig network afterwards,
#                 by the sidecar legacy-attach (compose.yaml here, the profile
#                 `legacy`), or manually with proxy-legacy-attach.
#   3. Certs      the legacy sites' domains are read from their Traefik rules and
#                 get certs from the same sidecar (share/sites/legacy/).
#   4. CA trust   two mkcert CAs; the legacy CA is added to the rig's bundle
#                 (.cert/extra-ca/) and the rig's CA to the akka-tools bundle.
#
# Router labels need NOTHING: the legacy sites set explicit
# traefik.http.routers.*.rule, and the rig's defaultRule only applies to containers
# without a rule. The tasks are called proxy-legacy-* because they operate on the
# machine's proxy; the helpers are plugin-private (legacy_*).

# akka-tools as pushed has ONE container: akka-proxy. akka-dns/akka-cert only exist
# in checkouts that carry the uncommitted prototype the rig services grew out of.
# The list takes all three and skips those that do not exist.
LEGACY_CONTAINERS="akka-proxy akka-dns akka-cert"
LEGACY_CA_DIR=".cert/extra-ca"
LEGACY_CA="$LEGACY_CA_DIR/akka-tools-rootCA.pem"

# Where does akka-tools live? Argument, otherwise $AKKA_TOOLS, otherwise the sibling
# directory. Returns a status instead of calling die: called in a command substitution.
legacy_tools() {
  local dir
  for dir in "${1-}" "${AKKA_TOOLS-}" "$(dirname "$RIG_MACHINE_CHECKOUT")/akka-tools"; do
    [ -n "$dir" ] || continue
    if [ -d "$dir/proxy" ] || [ -d "$dir/.cert" ]; then
      ( cd "$dir" && pwd )
      return 0
    fi
  done
  printf '❌ found no akka-tools checkout. Specify it: rig proxy-legacy <path>\n' >&2
  return 1
}

legacy_running() {
  [ "$(docker container inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]
}

# The ports can only be owned by one stack. Reversible: `make up` in akka-tools.
legacy_stop_akka() {
  local c n=0
  for c in $LEGACY_CONTAINERS; do
    if legacy_running "$c"; then
      docker stop "$c" >/dev/null
      n=$((n + 1))
    fi
  done
  if [ "$n" -gt 0 ]; then
    log "stopped $n akka-tools container(s) — 80/443/53 can only be owned by one stack"
    log "   back to the old proxy: rig proxy-legacy-off && rig proxy-down && (cd akka-tools && make up)"
  fi
}

# Cross-trust between the two mkcert CAs. Direction A: the legacy CA into the
# rig's bundle via .cert/extra-ca/ (proxy-ca-bundle includes everything there).
# Direction B: the rig's CA into the akka-tools bundle, which the legacy containers
# mount via $AKKA_CERT. Rebuilt from the .org file, so idempotent.
legacy_cross_trust() {
  local dir="$1/.cert" org="$1/.cert/ca-bundle.crt.org"
  if [ ! -f ".cert/rootCA.pem" ]; then
    log "the rig has no root CA yet — skipping the cross-trust"
    return 1
  fi
  if [ ! -f "$dir/rootCA.pem" ]; then
    log "no root CA in $dir — skipping the cross-trust"
    return 1
  fi
  if cmp -s "$dir/rootCA.pem" ".cert/rootCA.pem"; then
    log "same root CA in both checkouts — no cross-trust needed"
    rm -f "$LEGACY_CA"
    return 1
  fi
  mkdir -p "$LEGACY_CA_DIR"
  cp "$dir/rootCA.pem" "$LEGACY_CA"
  log "the legacy CA → $LEGACY_CA (included in the rig's ca-bundle)"
  if [ ! -f "$org" ]; then
    curl -sf -o "$org" \
      https://raw.githubusercontent.com/WordPress/WordPress/refs/heads/master/wp-includes/certificates/ca-bundle.crt \
      || { log "⚠️  could not fetch the base bundle to $org — skipping direction B"; return 0; }
  fi
  cat "$org" "$dir/rootCA.pem" ".cert/rootCA.pem" > "$dir/ca-bundle.crt.tmp"
  mv "$dir/ca-bundle.crt.tmp" "$dir/ca-bundle.crt"
  log "the rig's CA → $dir/ca-bundle.crt (the legacy containers trust the rig certs)"
}

# Static routes in the akka-tools dynamic config CANNOT be copied directly: the
# file also carries the tls block that points to akka-crt.pem. Say so instead.
legacy_static_routes() {
  local f="$1/proxy/dynamic/traefik.yaml"
  if [ -f "$f" ] && grep -q '^http:' "$f"; then
    log "⚠️  $f has static http routes — copy them by hand to"
    log "    ingress/traefik/dynamic/legacy-routes.yaml (only the http: block, not tls:)"
  fi
}

legacy_is_ingress() {
  docker inspect -f '{{range $k, $v := .Config.Labels}}{{$k}}{{"\n"}}{{end}}' "$1" 2>/dev/null \
    | grep -qE '^(traefik\.http\.routers\..*\.rule|rig\.hosts)$'
}

legacy_on_rig() {
  docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$1" 2>/dev/null \
    | grep -qw rig
}

# The legacy sites' network is `external: true` and was created by the akka-tools
# compose. If the akka stack is down the network is gone and the site's `make up`
# dies on "network proxy declared as external, but could not be found".
#
# Own task and not a private helper, for the same reason as proxy-cache-volumes:
# the network is a named resource that no compose file owns, so no stack recreates
# it. And since it is unused as long as no legacy site runs, `docker system prune`
# removes it. Hence it is needed by both proxy-up and proxy-setup, and hence it
# exists as a command you can run yourself. Idempotent.
doc proxy-legacy-network "Create the network 'proxy' that unmigrated akka-tools sites require"
task::proxy-legacy-network() {
  if docker network inspect proxy >/dev/null 2>&1; then
    return 0
  fi
  docker network create proxy >/dev/null
  log "created the network 'proxy' — the legacy sites' compose requires it to exist"
}

# Hook for proxy-setup. `detect`: 0 if an akka-tools checkout exists (and
# proxy-setup should take the ingress this way). Without arguments: inherit the CA
# before proxy-cert creates a new one, so there is ONE CA on the machine, everything
# already issued stays valid and `mkcert -install` never asks for a password. Then
# run proxy-legacy.
doc proxy-legacy-setup "Hook for proxy-setup: inherit the akka-tools CA and take over the ingress (detect = check only)"
task::proxy-legacy-setup() {
  local tools
  tools="$(legacy_tools "" 2>/dev/null)" || return 1
  if [ "${1-}" = detect ]; then
    return 0
  fi
  log "akka-tools exists next to it ($tools) — taking over the ingress from there (--fresh skips this)"
  (
    rig_in_machine_checkout
    if [ -f ".cert/rootCA-key.pem" ]; then
      log "the rig already has its own root CA — keeping it (cross-trust below)"
    elif [ -f "$tools/.cert/rootCA-key.pem" ]; then
      mkdir -p .cert
      cp "$tools/.cert/rootCA.pem" "$tools/.cert/rootCA-key.pem" .cert/
      log "inherited the root CA from akka-tools — existing certs and keychain trust stay valid"
    fi
  )
  need proxy-legacy
  log "   legacy site:  cd <site> && make up    — unchanged, it runs behind the rig proxy now"
}

doc proxy-legacy "Run unmigrated akka-tools sites behind the rig proxy: rig proxy-legacy [<akka-tools>]"
task::proxy-legacy() {
  local tools
  tools="$(legacy_tools "${1-}")" || exit 1
  log "akka-tools: $tools"
  legacy_stop_akka
  need proxy-legacy-network
  need proxy-cert
  # The cross-trust AFTER proxy-cert, which creates the rig's root CA. Direct call
  # of proxy-ca-bundle, not need: proxy-cert has already run it, and the bundle
  # must be rebuilt NOW with the legacy CA in it.
  (
    rig_in_machine_checkout
    legacy_cross_trust "$tools" || true
    legacy_static_routes "$tools"
  )
  task::proxy-ca-bundle
  need proxy-up
  ( rig_in_machine_checkout && docker compose --profile legacy up -d --build legacy-attach )
  log "legacy-attach is running — connects ingress and issues certs when the sites start"
  need proxy-legacy-attach
  echo
  log "done — start the legacy sites as usual (make up / docker compose up -d)."
}

doc proxy-legacy-off "Turn off legacy mode: remove the sidecar (the rig proxy stays)"
task::proxy-legacy-off() {
  ( rig_in_machine_checkout && docker compose --profile legacy rm -sf legacy-attach >/dev/null )
  log "legacy-attach removed — new legacy containers are no longer connected automatically"
}

doc proxy-legacy-attach "Connect running sites' ingress to the rig network now (the sidecar otherwise does it at start)"
task::proxy-legacy-attach() {
  local c n=0
  for c in $(docker ps --format '{{.Names}}'); do
    case "$c" in rig-*) continue ;; esac
    legacy_is_ingress "$c" || continue
    legacy_on_rig "$c" && continue
    docker network connect rig "$c"
    log "$c → the rig network"
    n=$((n + 1))
  done
  if [ "$n" -eq 0 ]; then
    log "all running ingress containers are already on the rig network"
    return 0
  fi
  need proxy-reload
  log "connected $n container(s)"
}

doc proxy-legacy-status "Show legacy mode: akka-proxy, the sidecar, containers outside the rig network"
task::proxy-legacy-status() {
  local c outside=""
  if legacy_running akka-proxy; then
    echo "⚠️  akka-proxy is running — it owns 80/443, so rig-proxy cannot. 'rig proxy-legacy' takes over."
  else
    echo "✅ akka-proxy is not running"
  fi
  if legacy_running rig-legacy-attach; then
    echo "✅ legacy-attach is running (the profile legacy)"
  else
    echo "ℹ️  legacy-attach is not running — legacy mode is off ('rig proxy-legacy' turns it on)"
  fi
  for c in $(docker ps --format '{{.Names}}'); do
    case "$c" in rig-*) continue ;; esac
    legacy_is_ingress "$c" || continue
    legacy_on_rig "$c" || outside="$outside $c"
  done
  if [ -n "$outside" ]; then
    echo "⚠️  ingress containers outside the rig network:$outside — 'rig proxy-legacy-attach'"
  else
    echo "✅ all running ingress containers are on the rig network"
  fi
}
