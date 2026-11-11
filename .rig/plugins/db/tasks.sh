# db — MariaDB/MySQL + seed handling, instantiable per service
# (docs/decisions/2026-09-01-service-namespaces.md).
#
# The task bodies are parameterized over an instance context (DB_I_*), so the same
# code can drive several database services in one site. The default instance (the
# service db, the namespace db) is written out in full below. The rigfile keys
# (DB_BIN, ...) are parsed AFTER plugin loading and are therefore read at run time,
# and the names of dump/asset/golden volume are the historical ones. Extra instances
# are created by the site in rigtasks.sh via the factory rig_db_service (shared surface,
# the same class as the deploy plugin's provider contract):
#
#   rig_db_service statamic_db SERVICE=statamic-db BIN=mysql ...
#
# The client binaries can be overridden in rigfile (DB_BIN=mysql for older images).
# DB_WAIT_TIMEOUT is the ceiling in seconds for db-wait. DB_VOLUME is the compose
# key for the datadir volume, DB_COPY_IMAGE the small image that copies
# it (see GOLDEN VOLUME below). Global on purpose: a machine detail.

# The default instance in the seed registry: `rig setup` fans out over the registry, and
# `rig db seed` seeds this instance on its own. It used to be in RIG_SETUP,
# which made seeding a setup detail instead of a verb, and
# left extra instances out.
RIG_SEED+=(db-seed)

: "${DB_BIN:=mariadb}"
: "${DB_DUMP_BIN:=mariadb-dump}"
: "${DB_WAIT_TIMEOUT:=60}"
: "${DB_VOLUME:=db-data}"
: "${DB_COPY_IMAGE:=alpine:3.21}"

##############################################################################
## INSTANCE CONTEXT
#
# DB_I_NS            the namespace (prefix of the task names)
# DB_I_SERVICE       the compose service
# DB_I_BIN/DUMP_BIN  client binaries in the container
# DB_I_WAIT_TIMEOUT  ceiling in seconds for <ns>-wait
# DB_I_VOLUME        the compose KEY for the datadir volume
# DB_I_USER_VAR/PASSWORD_VAR/ROOT_PASSWORD_VAR/DB_VAR
#                    the NAMES of the env variables in the container (mariadb image:
#                    DB_USER/DB_PASSWORD/DB_NAME; mysql image: MYSQL_*)
# DB_I_DUMP          the dump's local path (.user/...)
# DB_I_ASSET         the asset name in the GH prerelease "seeds"
# DB_I_SEED_VOLUME   the golden volume's name

db_ctx_default() {
  DB_I_NS=db
  DB_I_SERVICE=db
  DB_I_BIN="$DB_BIN"
  DB_I_DUMP_BIN="$DB_DUMP_BIN"
  DB_I_WAIT_TIMEOUT="$DB_WAIT_TIMEOUT"
  DB_I_VOLUME="$DB_VOLUME"
  DB_I_USER_VAR=DB_USER
  DB_I_PASSWORD_VAR=DB_PASSWORD
  DB_I_ROOT_PASSWORD_VAR=DB_PASSWORD
  DB_I_DB_VAR=DB_NAME
  DB_I_DUMP=.user/seed.sql.gz
  DB_I_ASSET=seed.sql.gz
  DB_I_SEED_VOLUME="rig-seed-$(rig_slugify "$RIG_SITE")"
}

##############################################################################
## THE BODIES — everything below reads only DB_I_*

db_i_up() {
  docker compose up -d "$DB_I_SERVICE"
}

# Readiness = the site's user can read the site's database. Weaker probes
# (port open, mariadb-admin ping) go green before the entrypoint has created
# the database and grants, and then the next task fails instead.
db_i_probe() {
  docker compose exec -T "$DB_I_SERVICE" sh -c \
    "$DB_I_BIN --connect-timeout=2 -u \$$DB_I_USER_VAR -p\$$DB_I_PASSWORD_VAR -e 'SELECT 1' \$$DB_I_DB_VAR" \
    >/dev/null 2>&1
}

db_i_wait() {
  need "$DB_I_NS-up"
  # The loop is outside the container on purpose: a fresh volume restarts
  # the server during initialization, and an exec waiting inside the
  # container dies with it.
  local waited=0
  printf '⏳ Waiting for the database (%s)' "$DB_I_SERVICE"
  while ! db_i_probe; do
    if [ "$waited" -ge "$DB_I_WAIT_TIMEOUT" ]; then
      printf '\n'
      die "the database did not respond within ${DB_I_WAIT_TIMEOUT}s — see \`docker compose logs $DB_I_SERVICE\`"
    fi
    printf '.'
    sleep 1
    waited=$((waited + 1))
  done
  if [ "$waited" -eq 0 ]; then
    printf ' ready\n'
  else
    printf ' ready (%ss)\n' "$waited"
  fi
}

db_i_cli() {
  need "$DB_I_NS-wait"
  docker compose exec "$DB_I_SERVICE" sh -c \
    "$DB_I_BIN -u root -p\$$DB_I_ROOT_PASSWORD_VAR \$$DB_I_DB_VAR"
}

##############################################################################
## THE DUMP — raw SQL, the truth shared via GitHub
#
# Two seed tracks, never mixed in one command: the dump is the truth (the site's
# sanitized SQL dump, the GH prerelease "seeds"), the golden volume (next section)
# is a local cache of a finished import. `rig db import` never touches the volume,
# `rig db seed` never imports. The tracks meet only in seed-refresh/snapshot,
# which explicitly build the cache from the dump. Several instances share the prerelease
# but each has its own asset (seed.sql.gz and <instance>-seed.sql.gz respectively).
#
# An import always ends with ANALYZE TABLE (db_i_analyze): the dump carries
# tables, indexes and data but not InnoDB's index statistics, and without them
# the optimizer plans as if the tables were empty.

# The import runs as root: a full dump replaces the database and can carry
# DROP/CREATE that the site's user has no rights for.
#
# gunzip + sed on the HOST: the mysql image has no gunzip, and MariaDB 11 dumps
# start with the sandbox line /*M!999999...*/ that the MySQL client does not understand
# (ERROR: Unknown command '\-'). The mariadb client manages without the line.
db_i_import_gz() {
  need "$DB_I_NS-wait"
  gunzip -c "$1" | sed '1{/999999.*sandbox/d;}' \
    | docker compose exec -T "$DB_I_SERVICE" sh -c \
        "$DB_I_BIN -u root -p\$$DB_I_ROOT_PASSWORD_VAR \$$DB_I_DB_VAR"
  # The statistics live in the mysql.* tables, i.e. in the datadir volume: since
  # seed-refresh goes through this body BEFORE the snapshot, they are carried into
  # the golden volume, and every seed/seed-clone gets correct statistics
  # for free. That is why ANALYZE is here and not a separate step after
  # the snapshot.
  db_i_analyze
}

# An SQL dump recreates tables, indexes and data but not InnoDB's
# index statistics (mysql.innodb_index_stats): after an import every index
# has cardinality 0, and the automatic recalculation is asynchronous and
# unreliable after a bulk import. The statistics can be missing for weeks.
# The optimizer then believes the tables are empty and picks disastrous plans
# for queries with many joins and large IN lists (a WordPress term query:
# 22 s and 280 million examined rows → 65 ms after ANALYZE).
#
# The statement is generated from information_schema instead of mysqlcheck/
# mariadb-check: no new binary key, and the same code for BIN=mariadb and
# BIN=mysql. Root like the import: ANALYZE writes to mysql.*. The response (one line
# per table) is silenced; errors still go to stderr.
db_i_analyze() {
  need "$DB_I_NS-wait"
  local list count
  list="$(docker compose exec -T "$DB_I_SERVICE" sh -c \
    "$DB_I_BIN -N -B -u root -p\$$DB_I_ROOT_PASSWORD_VAR -e \"SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name\" \$$DB_I_DB_VAR" \
    2>/dev/null)"
  count="$(printf '%s\n' "$list" | grep -c . || true)"
  if [ "$count" = 0 ]; then
    log "no tables to analyze in $DB_I_SERVICE"
    return 0
  fi
  printf 'ANALYZE TABLE %s\n' "$(printf '%s\n' "$list" | sed 's/.*/`&`/' | paste -sd, -)" \
    | docker compose exec -T "$DB_I_SERVICE" sh -c \
        "$DB_I_BIN -u root -p\$$DB_I_ROOT_PASSWORD_VAR \$$DB_I_DB_VAR" \
    >/dev/null
  log "✅ index statistics recalculated: $count tables ($DB_I_SERVICE)"
}

# An import leaves the volume untouched, but a golden volume that is older than
# the database gives back the old data the next time an environment clones it. Say so
# where it happens, instead of forcing a snapshot.
db_i_snapshot_hint() {
  if docker volume inspect "$DB_I_SEED_VOLUME" >/dev/null 2>&1; then
    log "the golden volume is now older than the database — 'rig $DB_I_NS seed-snapshot' if new environments should get this data"
  fi
}

db_i_import() {
  if [ $# -ge 1 ]; then
    [ -f "$1" ] || die "no dump file: $1 — usage: rig $DB_I_NS import [dump.sql.gz]"
    db_i_import_gz "$1"
  else
    need "$DB_I_NS-download"
    db_i_import_gz "$DB_I_DUMP"
  fi
  db_i_snapshot_hint
}

db_i_download() {
  mkdir -p .user
  gh release download seeds --clobber -p "$DB_I_ASSET" -O "$DB_I_DUMP"
}

db_i_export() {
  need "$DB_I_NS-wait"
  mkdir -p .user
  docker compose exec -T "$DB_I_SERVICE" sh -c \
    "$DB_I_DUMP_BIN -u \$$DB_I_USER_VAR -p\$$DB_I_PASSWORD_VAR \$$DB_I_DB_VAR" \
    | gzip > "$DB_I_DUMP"
}

db_i_upload() {
  gh release view seeds >/dev/null 2>&1 \
    || gh release create seeds --prerelease --title "DB seeds" \
         --notes "Seed dumps for local dev. Not a software release."
  gh release upload seeds "$DB_I_DUMP" --clobber
}

##############################################################################
## GOLDEN VOLUME
#
# An SQL import of a production-like seed takes minutes and is paid again by every
# new environment. The files, however, are binary compatible between projects (same image,
# same server version), so a fully imported datadir can be copied as is
# in seconds. That copy is the *golden volume*: one per instance, never
# mounted by a running container, cloned by every new worktree environment.
#
# Two things make it valid to copy:
#   * it is only snapshotted from a CLEANLY SHUT DOWN database. A file copy of a
#     live InnoDB gives half-written pages.
#   * it carries the instance's mysql system tables, i.e. also the user and
#     its password. If the password is rotated in 1Password, the volume becomes invalid and
#     the next environment is denied login. Rebuild it with seed-refresh then.

db_i_seed() {
  # No dump argument: it mixed the tracks (import AND rebuild the volume
  # in one sweep) and made both hard to explain.
  [ $# -eq 0 ] || die "'rig $DB_I_NS seed' takes no arguments — import a dump with 'rig $DB_I_NS import $1' ('rig $DB_I_NS seed-snapshot' afterwards if new environments should get it)"
  if docker volume inspect "$DB_I_SEED_VOLUME" >/dev/null 2>&1; then
    need "$DB_I_NS-seed-clone"
  else
    need "$DB_I_NS-seed-refresh"
  fi
}

db_i_seed_refresh() {
  need "$DB_I_NS-download"
  db_i_import_gz "$DB_I_DUMP"
  need "$DB_I_NS-seed-snapshot"
}

# The instance's own datadir volume. Looked up by compose's own labels instead
# of assembled as <project>_<key>. The naming is compose's to own.
db_i_data_volume() {
  local project v
  project="$(rig_compose_project)"
  v="$(docker volume ls -q \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.volume=$DB_I_VOLUME")"
  # podman-compose sets only the project label, not the volume label. Fall back
  # to compose's <project>_<key> name, still within the project's volumes.
  if [ -z "$v" ]; then
    v="$(docker volume ls -q \
      --filter "label=com.docker.compose.project=$project" \
      | grep -x "${project}_$DB_I_VOLUME" || true)"
  fi
  printf '%s\n' "$v"
}

# The target is emptied first: cp -a into an existing datadir would have merged two
# databases instead of replacing one.
db_volume_copy() {
  docker run --rm -v "$1":/from:ro -v "$2":/to "$DB_COPY_IMAGE" \
    sh -c 'find /to -mindepth 1 -delete && cp -a /from/. /to/'
}

db_i_running() {
  [ -n "$(docker compose ps --status running -q "$DB_I_SERVICE" 2>/dev/null)" ]
}

db_i_seed_snapshot() {
  local src dst was_up=0
  dst="$DB_I_SEED_VOLUME"
  if db_i_running; then
    was_up=1
    log "stopping $DB_I_SERVICE — a file copy of a live InnoDB is corrupt"
    docker compose stop "$DB_I_SERVICE" >/dev/null
  fi
  src="$(db_i_data_volume)"
  [ -n "$src" ] || die "no datadir volume found for $DB_I_SERVICE in this project — run 'rig $DB_I_NS seed-refresh' first"
  docker volume rm -f "$dst" >/dev/null 2>&1 || true
  docker volume create --label "rig.site=$(rig_slugify "$RIG_SITE")" "$dst" >/dev/null
  db_volume_copy "$src" "$dst"
  log "✅ golden volume built: $dst — new environments clone it instead of importing"
  if [ "$was_up" = 1 ]; then
    docker compose start "$DB_I_SERVICE" >/dev/null
  fi
}

db_i_seed_clone() {
  local src dst
  src="$DB_I_SEED_VOLUME"
  docker volume inspect "$src" >/dev/null 2>&1 \
    || die "no golden volume ($src) — run 'rig $DB_I_NS seed-refresh' in an environment for the site"
  if db_i_running; then
    docker compose stop "$DB_I_SERVICE" >/dev/null
  fi
  # `up --no-start`, not `up`: compose sets up the volume with its own labels
  # without starting the server on a datadir we are about to overwrite. Not
  # `create`: podman-compose does not have it.
  docker compose up --no-start --no-deps "$DB_I_SERVICE" >/dev/null
  dst="$(db_i_data_volume)"
  [ -n "$dst" ] || die "compose created no volume labeled '$DB_I_VOLUME' — the instance's VOLUME must be the compose key for the datadir"
  db_volume_copy "$src" "$dst"
  log "✅ database cloned from $src"
  # Started again so that seed leaves the server running, as the import track
  # does. A later `need db-up` is memoized and would not start it.
  db_i_up >/dev/null
  db_i_wait
}

db_i_seed_volume_rm() {
  docker volume rm -f "$DB_I_SEED_VOLUME" >/dev/null 2>&1 || true
  log "✅ removed: $DB_I_SEED_VOLUME"
}

##############################################################################
## DOCTOR
#
# This is the error no declaration check can see: the datadir volume carries
# the instance's mysql system tables, i.e. the user and its password.
# If the password is rotated in 1Password (or a golden volume from before the
# rotation is cloned), .env no longer matches the volume, and every app gets "Access
# denied", while compose, volumes and network are all green.

db_i_doctor() {
  rig_dr_section "🗄  Database ($DB_I_SERVICE)..."
  if ! rig_dr_state_ready || ! rig_dr_running "$DB_I_SERVICE"; then
    rig_dr_warn "$DB_I_SERVICE is not running — skipping the database check ('rig up')"
    return 0
  fi

  if db_i_probe; then
    rig_dr_ok "$DB_I_SERVICE: the site's user can read the site's database"
  else
    rig_dr_fail "$DB_I_SERVICE: $DB_I_USER_VAR/$DB_I_PASSWORD_VAR in .env do not match the datadir volume" \
      "rotated password? rebuild the seed: rig $DB_I_NS seed-refresh (and 'rig env' first)"
    rig_dr_tail "$DB_I_SERVICE"
    return 1
  fi

  # An empty database is not broken, but it is almost never intentional, and
  # the symptom (an installation wizard, or a 500 from the app) leads nobody here.
  local tables
  tables="$(docker compose exec -T "$DB_I_SERVICE" sh -c \
    "$DB_I_BIN -N -B --connect-timeout=2 -u \$$DB_I_USER_VAR -p\$$DB_I_PASSWORD_VAR -e 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()' \$$DB_I_DB_VAR" \
    2>/dev/null | tr -d '[:space:]')" || true
  if [ "${tables:-0}" = 0 ]; then
    rig_dr_warn "$DB_I_SERVICE: the database has zero tables — 'rig $DB_I_NS seed'"
  else
    rig_dr_ok "$DB_I_SERVICE: $tables tables"
    db_i_doctor_stats
  fi

  # The golden volume belongs to the instance, not the environment: if it is missing,
  # every new worktree environment imports the seed from scratch instead of cloning.
  if docker volume inspect "$DB_I_SEED_VOLUME" >/dev/null 2>&1; then
    rig_dr_ok "$DB_I_SERVICE: golden volume exists ($DB_I_SEED_VOLUME)"
  else
    rig_dr_warn "$DB_I_SERVICE: no golden volume ($DB_I_SEED_VOLUME) — new environments have to import the seed. 'rig $DB_I_NS seed-snapshot'"
  fi
  rig_dr_verdict
}

# This is the error no declaration check can see, and nobody looks for it
# in the database: a dump does not carry InnoDB's index statistics, so an imported
# database is correct (right tables, right indexes, right data) but the optimizer
# plans as if the tables were empty. The symptom is "the site is slow locally",
# and troubleshooting goes to Docker and the proxy. Tables with rows but indexes
# without cardinality are the signature (the row count is updated on insert,
# the cardinality only by ANALYZE). Warning, not error: the database works,
# it is just slow.
db_i_doctor_stats() {
  local unanalyzed
  unanalyzed="$(docker compose exec -T "$DB_I_SERVICE" sh -c \
    "$DB_I_BIN -N -B --connect-timeout=2 -u \$$DB_I_USER_VAR -p\$$DB_I_PASSWORD_VAR -e \"SELECT COUNT(DISTINCT s.table_name) FROM information_schema.statistics s JOIN information_schema.tables t ON t.table_schema = s.table_schema AND t.table_name = s.table_name WHERE s.table_schema = DATABASE() AND t.table_type = 'BASE TABLE' AND t.table_rows > 0 AND (s.cardinality IS NULL OR s.cardinality = 0)\" \$$DB_I_DB_VAR" \
    2>/dev/null | tr -d '[:space:]')" || true
  if [ "${unanalyzed:-0}" = 0 ]; then
    rig_dr_ok "$DB_I_SERVICE: index statistics exist"
  else
    rig_dr_warn "$DB_I_SERVICE: $unanalyzed tables lack index statistics — slow queries. 'rig $DB_I_NS analyze'"
  fi
}

##############################################################################
## THE DEFAULT INSTANCE — the service db, the historical names

RIG_DOCTOR+=(db-doctor)

doc db-up "Start the db service"
task::db-up() {
  db_ctx_default
  db_i_up "$@"
}

doc db-wait "Wait until the database accepts connections"
task::db-wait() {
  db_ctx_default
  db_i_wait "$@"
}

doc db-cli "MariaDB shell"
task::db-cli() {
  db_ctx_default
  db_i_cli "$@"
}

doc db-import "Import an SQL dump — without a file, the seed dump is fetched from GitHub first: rig db import [dump.sql.gz]"
task::db-import() {
  db_ctx_default
  db_i_import "$@"
}

doc db-analyze "Recalculate the index statistics (ANALYZE TABLE on all tables) — the import does it itself"
task::db-analyze() {
  db_ctx_default
  db_i_analyze "$@"
}

doc db-download "Fetch the seed dump from the GitHub prerelease \"seeds\" to .user/seed.sql.gz"
task::db-download() {
  db_ctx_default
  db_i_download "$@"
}

doc db-export "Dump the database to .user/seed.sql.gz"
task::db-export() {
  db_ctx_default
  db_i_export "$@"
}

doc db-upload "Upload .user/seed.sql.gz to the GitHub prerelease \"seeds\""
task::db-upload() {
  db_ctx_default
  db_i_upload "$@"
}

doc db-seed "Seed the database from the site's golden volume — cloned in seconds, built when needed"
task::db-seed() {
  db_ctx_default
  db_i_seed "$@"
}

doc db-seed-refresh "Rebuild the golden volume from the latest GH dump: fetch, import, snapshot"
task::db-seed-refresh() {
  db_ctx_default
  db_i_seed_refresh "$@"
}

doc db-seed-snapshot "Snapshot the project's db volume to the site's golden volume"
task::db-seed-snapshot() {
  db_ctx_default
  db_i_seed_snapshot "$@"
}

doc db-seed-clone "Fill the project's db volume from the site's golden volume (seconds, no import)"
task::db-seed-clone() {
  db_ctx_default
  db_i_seed_clone "$@"
}

doc db-seed-volume-rm "Remove the site's golden db volume"
task::db-seed-volume-rm() {
  db_ctx_default
  db_i_seed_volume_rm "$@"
}

doc db-doctor "Doctor checks for the database (credentials, content)"
task::db-doctor() {
  db_ctx_default
  db_i_doctor "$@"
}

##############################################################################
## THE FACTORY — one more instance of the db role
#
# Called by the RUNNER (load_instance in bin/rig) for every service with the label
# rig.plugin=db in compose. The declaration is a per-service fact and lives there:
#
#   statamic-db:
#     image: mysql/mysql-server:8.0
#     labels:
#       - rig.plugin=db
#       - rig.plugin.bin=mysql
#       - rig.plugin.dump_bin=mysqldump
#       - rig.plugin.user_var=MYSQL_USER
#       - rig.plugin.password_var=MYSQL_PASSWORD
#       - rig.plugin.root_password_var=MYSQL_ROOT_PASSWORD
#       - rig.plugin.db_var=MYSQL_DATABASE
#       - rig.plugin.volume=cms-db-data
#
# The namespace is derived from the service name (statamic-db → statamic_db), and
# the instance gets the whole verb family registered via doc. F7 and `rig where`
# apply, and point at the compose label.
#
#   rig_db_service <instance> [SERVICE=<service>] [BIN=| DUMP_BIN=| VOLUME=|
#                  WAIT_TIMEOUT=| USER_VAR=| PASSWORD_VAR=|
#                  ROOT_PASSWORD_VAR=| DB_VAR=<value>]
#
# The factory adds the instance to RIG_SEED: `rig seed`, and thereby `rig setup`,
# seeds EVERY database the site has declared. Until 2026-09-05 it was
# the site's own choice (RIG_SETUP+=(<instance>-seed) by hand). But a site with
# two databases in practice always wants data in both after setup, and
# forgetting the line gave an empty database that first showed up as an application error.
# RIG_SETUP is untouched and remains for site-specific ordering after seeding.
rig_db_service() {
  local ns="${1-}"
  # Phase-out (stage 2): factory calls from rigtasks.sh were the stage 1 form.
  # Hard switch with a signpost as always. Soft in the repair path (warn and
  # register anyway), so 'rig self update' is never blocked mid-move.
  case "$RIG_FILE" in
    */rigtasks.sh)
      if [ "${RIG_REPAIR:-0}" = 1 ]; then
        log "⚠️  rig_db_service in rigtasks.sh — move the declaration to labels on the service in compose (rig.plugin=db) and remove the call"
      else
        die "rig_db_service is no longer called from rigtasks.sh — set labels on the service in compose: rig.plugin=db + rig.plugin.<arg>=<value> (docs/decisions/2026-09-01-service-namespaces.md)"
      fi
      ;;
  esac
  # Hyphen is the separator between namespace and verb (CLI API): an
  # instance name with a hyphen makes the space form ambiguous.
  case "$ns" in
    "" | *[!a-z0-9_]*)
      die "rig_db_service: instance name '$ns' — [a-z0-9_]+ required, no hyphens (the service in compose can be named anything via SERVICE=)"
      ;;
  esac
  shift
  local service="$ns" bin=mariadb dump_bin=mariadb-dump wait_timeout=60 volume=""
  local user_var=DB_USER password_var=DB_PASSWORD root_password_var=DB_PASSWORD db_var=DB_NAME
  local arg val
  for arg in "$@"; do
    val="${arg#*=}"
    # The values are baked into eval-generated functions: the charset validation is
    # what makes it safe (no spaces, quotes or $).
    case "$val" in
      "" | *[!A-Za-z0-9._/-]*)
        die "rig_db_service $ns: the value in '$arg' — allowed characters: A-Za-z0-9._/-"
        ;;
    esac
    case "$arg" in
      SERVICE=*) service="$val" ;;
      BIN=*) bin="$val" ;;
      DUMP_BIN=*) dump_bin="$val" ;;
      WAIT_TIMEOUT=*) wait_timeout="$val" ;;
      VOLUME=*) volume="$val" ;;
      USER_VAR=*) user_var="$val" ;;
      PASSWORD_VAR=*) password_var="$val" ;;
      ROOT_PASSWORD_VAR=*) root_password_var="$val" ;;
      DB_VAR=*) db_var="$val" ;;
      *) die "rig_db_service $ns: unknown argument '$arg' — SERVICE BIN DUMP_BIN WAIT_TIMEOUT VOLUME USER_VAR PASSWORD_VAR ROOT_PASSWORD_VAR DB_VAR" ;;
    esac
  done
  if [ -z "$volume" ]; then
    volume="$service-data"
  fi
  local seed_volume
  seed_volume="rig-seed-$(rig_slugify "$RIG_SITE")-$ns"
  eval "db_ctx_$ns() {
    DB_I_NS=$ns
    DB_I_SERVICE=$service
    DB_I_BIN=$bin
    DB_I_DUMP_BIN=$dump_bin
    DB_I_WAIT_TIMEOUT=$wait_timeout
    DB_I_VOLUME=$volume
    DB_I_USER_VAR=$user_var
    DB_I_PASSWORD_VAR=$password_var
    DB_I_ROOT_PASSWORD_VAR=$root_password_var
    DB_I_DB_VAR=$db_var
    DB_I_DUMP=.user/$ns-seed.sql.gz
    DB_I_ASSET=$ns-seed.sql.gz
    DB_I_SEED_VOLUME=$seed_volume
  }"
  local v
  for v in up wait cli import analyze download export upload seed seed-refresh seed-snapshot seed-clone seed-volume-rm doctor; do
    eval "task::$ns-$v() {
      db_ctx_$ns
      db_i_$(printf '%s' "$v" | tr - _) \"\$@\"
    }"
  done
  doc "$ns-up" "Start the $service service"
  doc "$ns-wait" "Wait until the database ($service) accepts connections"
  doc "$ns-cli" "Database shell in $service"
  doc "$ns-import" "Import an SQL dump — without a file, the seed dump is fetched from GitHub first: rig $ns import [dump.sql.gz]"
  doc "$ns-analyze" "Recalculate the index statistics in $service (ANALYZE TABLE on all tables) — the import does it itself"
  doc "$ns-download" "Fetch the seed dump from the GitHub prerelease \"seeds\" to .user/$ns-seed.sql.gz"
  doc "$ns-export" "Dump the database ($service) to .user/$ns-seed.sql.gz"
  doc "$ns-upload" "Upload .user/$ns-seed.sql.gz to the GitHub prerelease \"seeds\""
  doc "$ns-seed" "Seed $service from the instance's golden volume — cloned in seconds, built when needed"
  doc "$ns-seed-refresh" "Rebuild the golden volume from the latest GH dump: fetch, import, snapshot"
  doc "$ns-seed-snapshot" "Snapshot the $service volume to the instance's golden volume"
  doc "$ns-seed-clone" "Fill the $service volume from the instance's golden volume (seconds, no import)"
  doc "$ns-seed-volume-rm" "Remove the instance's golden volume"
  doc "$ns-doctor" "Doctor checks for the database ($service)"
  RIG_DOCTOR[${#RIG_DOCTOR[@]}]="$ns-doctor"
  RIG_SEED[${#RIG_SEED[@]}]="$ns-seed"
}
