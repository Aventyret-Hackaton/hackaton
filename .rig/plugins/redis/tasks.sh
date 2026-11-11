# redis — Redis cache, instantiable per service
# (docs/decisions/2026-09-01-service-namespaces.md).
#
# The default instance (the service redis) is written out in full below. An extra
# redis service gets the label rig.plugin=redis in compose and the whole verb family
# under its own namespace.

##############################################################################
## INSTANCE CONTEXT — REDIS_I_NS (the namespace), REDIS_I_SERVICE (the compose service)

redis_ctx_default() {
  REDIS_I_NS=redis
  REDIS_I_SERVICE=redis
}

##############################################################################
## THE BODIES — read only REDIS_I_*

redis_i_up() {
  docker compose up -d "$REDIS_I_SERVICE"
}

redis_i_cli() {
  need "$REDIS_I_NS-up"
  docker compose exec "$REDIS_I_SERVICE" sh -c 'redis-cli'
}

redis_i_doctor() {
  rig_dr_section "🧠 Redis ($REDIS_I_SERVICE)..."
  if ! rig_dr_state_ready || ! rig_dr_running "$REDIS_I_SERVICE"; then
    rig_dr_warn "$REDIS_I_SERVICE is not running — skipping ('rig up')"
    return 0
  fi
  # A running container is not the same as a server that answers: maxmemory
  # or a broken dump.rdb makes redis start and then refuse calls.
  if [ "$(rig_dr_exec "$REDIS_I_SERVICE" 'redis-cli ping' 2>/dev/null | tr -d '[:space:]')" = PONG ]; then
    rig_dr_ok "$REDIS_I_SERVICE: answers PONG"
  else
    rig_dr_fail "$REDIS_I_SERVICE: running but does not answer ping" "rig logs $REDIS_I_SERVICE"
  fi
  rig_dr_verdict
}

##############################################################################
## THE DEFAULT INSTANCE — the service redis

RIG_DOCTOR+=(redis-doctor)

doc redis-up "Start the redis service"
task::redis-up() {
  redis_ctx_default
  redis_i_up "$@"
}

doc redis-cli "Redis shell"
task::redis-cli() {
  redis_ctx_default
  redis_i_cli "$@"
}

doc redis-doctor "Doctor check for redis (does it answer?)"
task::redis-doctor() {
  redis_ctx_default
  redis_i_doctor "$@"
}

##############################################################################
## THE FACTORY — called by the runner (load_instance) for services with the label
## rig.plugin=redis in compose. No instance arguments besides SERVICE.

rig_redis_service() {
  local ns="${1-}"
  case "$RIG_FILE" in
    */rigtasks.sh)
      if [ "${RIG_REPAIR:-0}" = 1 ]; then
        log "⚠️  rig_redis_service in rigtasks.sh — declare it with the label rig.plugin=redis on the service in compose"
      else
        die "rig_redis_service is not called from rigtasks.sh — set the label rig.plugin=redis on the service in compose (docs/decisions/2026-09-01-service-namespaces.md)"
      fi
      ;;
  esac
  case "$ns" in
    "" | *[!a-z0-9_]*)
      die "rig_redis_service: instance name '$ns' — [a-z0-9_]+ required"
      ;;
  esac
  shift
  local service="$ns" arg val
  for arg in "$@"; do
    val="${arg#*=}"
    case "$val" in
      "" | *[!A-Za-z0-9._/-]*)
        die "rig_redis_service $ns: the value in '$arg' — allowed characters: A-Za-z0-9._/-"
        ;;
    esac
    case "$arg" in
      SERVICE=*) service="$val" ;;
      *) die "rig_redis_service $ns: unknown argument '$arg' — SERVICE" ;;
    esac
  done
  eval "redis_ctx_$ns() {
    REDIS_I_NS=$ns
    REDIS_I_SERVICE=$service
  }"
  local v
  for v in up cli doctor; do
    eval "task::$ns-$v() {
      redis_ctx_$ns
      redis_i_$v \"\$@\"
    }"
  done
  doc "$ns-up" "Start the $service service"
  doc "$ns-cli" "Redis shell in $service"
  doc "$ns-doctor" "Doctor check for $service (does it answer?)"
  RIG_DOCTOR[${#RIG_DOCTOR[@]}]="$ns-doctor"
}
