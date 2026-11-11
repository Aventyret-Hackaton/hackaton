# app — generic app container, instantiable only
# (docs/decisions/2026-09-01-service-namespaces.md).
#
# The plugin has no default instance and no tasks of its own: a service gets
# `up` and `cli` through the label rig.plugin=app in compose, and the site adds
# its own verbs in the same namespace in rigtasks.sh (install, build, migrate …).
#
#   statamic:
#     labels:
#       - rig.plugin=app              # rig statamic up / rig statamic cli
#       - rig.plugin.shell=sh         # alpine images without bash
#
# The namespace is shared: the instance owns up/cli, rigtasks.sh the rest. F7 catches a
# collision per task as usual.

##############################################################################
## INSTANCE CONTEXT — APP_I_NS, APP_I_SERVICE, APP_I_SHELL (the shell in cli)

app_i_up() {
  docker compose up -d "$APP_I_SERVICE"
}

app_i_cli() {
  need "$APP_I_NS-up"
  docker compose exec "$APP_I_SERVICE" "$APP_I_SHELL"
}

##############################################################################
## THE FACTORY — called by the runner (load_instance) for services with the label
## rig.plugin=app in compose. Arguments: SERVICE, SHELL (default bash).

rig_app_service() {
  local ns="${1-}"
  case "$RIG_FILE" in
    */rigtasks.sh)
      if [ "${RIG_REPAIR:-0}" = 1 ]; then
        log "⚠️  rig_app_service in rigtasks.sh — declare it with the label rig.plugin=app on the service in compose"
      else
        die "rig_app_service is not called from rigtasks.sh — set the label rig.plugin=app on the service in compose (docs/decisions/2026-09-01-service-namespaces.md)"
      fi
      ;;
  esac
  case "$ns" in
    "" | *[!a-z0-9_]*)
      die "rig_app_service: instance name '$ns' — [a-z0-9_]+ required"
      ;;
  esac
  shift
  local service="$ns" shell=bash arg val
  for arg in "$@"; do
    val="${arg#*=}"
    case "$val" in
      "" | *[!A-Za-z0-9._/-]*)
        die "rig_app_service $ns: the value in '$arg' — allowed characters: A-Za-z0-9._/-"
        ;;
    esac
    case "$arg" in
      SERVICE=*) service="$val" ;;
      SHELL=*) shell="$val" ;;
      *) die "rig_app_service $ns: unknown argument '$arg' — SERVICE SHELL" ;;
    esac
  done
  eval "app_ctx_$ns() {
    APP_I_NS=$ns
    APP_I_SERVICE=$service
    APP_I_SHELL=$shell
  }"
  local v
  for v in up cli; do
    eval "task::$ns-$v() {
      app_ctx_$ns
      app_i_$v \"\$@\"
    }"
  done
  doc "$ns-up" "Start the $service service"
  doc "$ns-cli" "Shell ($shell) in the $service container"
}
