# proxy — machine infrastructure: shared Traefik, *.test DNS and automatic TLS certs.
# One instance per developer machine; the sites have their own plugins.
#
# The plugin is ALWAYS loaded, even inside a site, so `rig proxy up` works
# everywhere. The tasks therefore always operate on the checkout explicitly, in a
# subshell, so the site's cwd is untouched afterwards.
#
# The names are proxy-* and therefore do not clash with core's up/down/logs, which
# mean the site's stack. The scope is in the grammar, never in the cwd.

PROXY_CAROOT=".cert"

# The machine's checkout: the one `rig` on PATH points into (RIG_MACHINE_CHECKOUT,
# set by the runner on PATH and inherited when the site's pinned runner is exec'd
# from the cache). That is where .cert, the proxy's compose and doctor.sh live. If a
# pinned runner is run directly from the cache (without the launcher) there is no
# machine checkout to guess. Say so instead of running docker compose in the wrong
# directory. $RIG is the explicit override.
#
# Returns a status instead of calling die: die inside a command substitution only
# kills the subshell, and the caller would continue.
# Shared surface (rig_*): proxy is always loaded, and plugin legacy uses them.
rig_machine_checkout() {
  if [ -d "$RIG_MACHINE_CHECKOUT/ingress/traefik" ]; then
    printf '%s\n' "$RIG_MACHINE_CHECKOUT"
    return 0
  fi
  if [ -n "${RIG-}" ] && [ -d "$RIG/ingress/traefik" ]; then
    printf '%s\n' "$RIG"
    return 0
  fi
  printf '❌ the proxy tasks need the aventyret-rig checkout, but the runner was run from %s.\n' "$RIG_MACHINE_CHECKOUT" >&2
  printf "   Run the global \`rig\` (install with './bin/rig proxy-cli-setup' in the checkout), or set RIG=/path/to/aventyret-rig.\n" >&2
  return 1
}

# COMPOSE_FILE is cleared: it points to the SITE's file list (relative names, set by
# the runner when compose.rig.yaml exists) and would otherwise follow along into the
# checkout and point at the wrong, or nonexistent, files for the rig stack's own
# compose.
#
# RIG_DOCKER_SOCK is exported for the rig stack's compose (rig_docker_sock).
rig_in_machine_checkout() {
  local dir
  dir="$(rig_machine_checkout)" || return 1
  unset COMPOSE_FILE
  RIG_DOCKER_SOCK="$(rig_docker_sock)"
  export RIG_DOCKER_SOCK
  cd "$dir"
}

# The engine's socket on the host, mounted into the services that follow docker
# events (rig-proxy, rig-cert, rig-legacy-attach). /var/run/docker.sock is only
# Docker's default: on rootless Podman it is missing or a root-owned link, and
# rootless Docker has its own. The engine is asked instead. Docker Desktop is
# the exception: its VM serves /var/run/docker.sock to containers, and the
# host-side path in the context cannot be mounted. RIG_DOCKER_SOCK in the
# environment wins. Prints the path.
rig_docker_sock() {
  local host=""
  if [ -n "${RIG_DOCKER_SOCK-}" ]; then
    printf '%s\n' "$RIG_DOCKER_SOCK"
    return 0
  fi
  if [ "${RIG_ENGINE-}" = podman ]; then
    host="$(docker info --format '{{.Host.RemoteSocket.Path}}' 2>/dev/null)"
  elif [ "$(docker info --format '{{.OperatingSystem}}' 2>/dev/null)" != "Docker Desktop" ]; then
    host="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null)"
  fi
  case "$host" in
    unix:///*) host="${host#unix://}" ;;
    /*) ;;
    *) host=/var/run/docker.sock ;;
  esac
  printf '%s\n' "$host"
}

# True if *.test already points to rig-dns, regardless of OS mechanics. Shared by
# proxy-setup (skip the sudo step) and doctor.sh (same truth, own file).
dns_test_configured() {
  case "$(uname)" in
    Darwin)
      grep -qs '^nameserver 127.0.0.1$' /etc/resolver/test \
        && grep -qs '^port 5300$' /etc/resolver/test
      ;;
    Linux)
      grep -qs '^DNS=127.0.0.1:5300$' /etc/systemd/resolved.conf.d/rig-test.conf \
        && grep -qs '^Domains=~test$' /etc/systemd/resolved.conf.d/rig-test.conf
      ;;
    *)
      return 1
      ;;
  esac
}

doc proxy-up "Start the proxy, dns and cert services"
task::proxy-up() {
  need proxy-cert
  need proxy-cache-volumes
  # The network that unmigrated sites share. Plugin legacy owns the knowledge of it
  # and disappears when the last site has migrated, hence is_task and not a plain
  # need. Cheap (one docker network inspect) and makes the network self-healing:
  # it is unused when no legacy site runs, so a prune removes it.
  if is_task proxy-legacy-network; then
    need proxy-legacy-network
  fi
  ( rig_in_machine_checkout && docker compose up -d --build )
}

# Cheap guard (~50ms): without it a stopped rig fails cryptically ("network rig
# could not be found") or starts silently with dead *.test routing. Inside a site it
# also checks .env and the cert seam (rig_hosts_check is site's shared surface; site
# is always loaded when SITE_DIR is set). Was called rig-check and lived in site
# until the CLI API decision 2026-09-01. It checks the machine stack.
doc proxy-check "Fail fast if the rig stack is not running"
task::proxy-check() {
  [ "$(docker container inspect -f '{{.State.Running}}' rig-proxy 2>/dev/null)" = "true" ] \
    || die "aventyret-rig is not running — run 'rig proxy up' (and 'rig proxy doctor' if it acts up)"
  if [ -n "$SITE_DIR" ]; then
    if [ -n "${RIG_SITE:-}" ]; then
      # Compose interpolates ${RIG_HOST_BASE} from .env. A missing .env, or one with
      # the wrong base (e.g. copied into a worktree), gives empty domains and router
      # names, so catch it before compose starts.
      local base
      base="$(rig_host_base)"
      grep -qs "^RIG_HOST_BASE=$base\$" .env \
        || die ".env is missing RIG_HOST_BASE=$base — run 'rig env' (compose interpolates it into domains/labels)"
    fi
    rig_hosts_check || die "compose: hostname and rig.hosts disagree (see above)"
  fi
}

# --profile '*': services behind a profile (the legacy sidecar) are otherwise not
# taken down by a plain `compose down`.
doc proxy-down "Stop the rig stack"
task::proxy-down() {
  ( rig_in_machine_checkout && docker compose --profile '*' down )
}

doc proxy-logs "Follow logs from the rig stack"
task::proxy-logs() {
  # Follows only in a terminal, like 'rig logs'.
  if [ -t 1 ]; then
    ( rig_in_machine_checkout && docker compose logs -f "$@" )
  else
    ( rig_in_machine_checkout && docker compose logs "$@" )
  fi
}

# Shared package manager caches that the sites' stacks mount. Plain named volumes:
# no rig service mounts them, so compose would never create them.
doc proxy-cache-volumes "Create the shared package manager cache volumes"
task::proxy-cache-volumes() {
  local v
  for v in rig-pnpm-store rig-npm-cache rig-composer-cache; do
    docker volume inspect "$v" >/dev/null 2>&1 || docker volume create "$v" >/dev/null
  done
}

##############################################################################
## CERT
#
# Per-site certs are issued at runtime by the rig-cert service (label rig.hosts);
# the default cert here is only the SNI fallback for rig.test.

doc proxy-cert "Create the root CA and the default cert"
task::proxy-cert() {
  (
    rig_in_machine_checkout
    mkdir -p "$PROXY_CAROOT"
    if [ ! -f "$PROXY_CAROOT/rootCA-key.pem" ]; then
      CAROOT="$PROXY_CAROOT" mkcert -install
    fi
    if [ ! -f "$PROXY_CAROOT/rig-key.pem" ]; then
      CAROOT="$PROXY_CAROOT" mkcert \
        --key-file "$PROXY_CAROOT/rig-key.pem" \
        --cert-file "$PROXY_CAROOT/rig-crt.pem" \
        rig.test "*.rig.test"
    fi
  )
  need proxy-ca-bundle
}

# Append the rootCA (not a leaf cert) to WP's curl bundle: then PHP/curl trusts
# every cert the CA ever signs, including the per-site certs issued at runtime, and
# the bundle never needs rebuilding. share/ is published to the site containers as
# the docker volume `rig-cert`: public material only, never keys.
doc proxy-ca-bundle "Build the CA bundle the site containers trust"
task::proxy-ca-bundle() {
  (
    rig_in_machine_checkout
    curl -sf -o "$PROXY_CAROOT/ca-bundle.crt.org" \
      https://raw.githubusercontent.com/WordPress/WordPress/refs/heads/master/wp-includes/certificates/ca-bundle.crt
    # Extra CAs in .cert/extra-ca/*.pem are included (plugin legacy puts the
    # akka-tools CA there, so a migrated site can call an unmigrated one over
    # https). The bundle is built from scratch every time, hence not an append.
    local extra
    extra="$(ls "$PROXY_CAROOT"/extra-ca/*.pem 2>/dev/null || true)"
    # shellcheck disable=SC2086
    cat "$PROXY_CAROOT/ca-bundle.crt.org" "$PROXY_CAROOT/rootCA.pem" $extra \
      > "$PROXY_CAROOT/ca-bundle.crt"
    # share/sites/ is created HERE and not by the rig-cert container (watch.sh),
    # which runs as root: on Linux the directory would then be root-owned, and unlink
    # needs write permission on the DIRECTORY, not on the file. The host could then
    # not clean up the certs (proxy cert-rm, proxy cert-clean, worktree rm) without
    # sudo. The directory is host-owned, the files in it root-owned: that is enough.
    mkdir -p "$PROXY_CAROOT/share/sites"
    cp "$PROXY_CAROOT/rootCA.pem" "$PROXY_CAROOT/ca-bundle.crt" "$PROXY_CAROOT/share/"
  )
}

# Remove ONE environment's cert. Called by worktree-rm when a PR environment is
# torn down: without it share/sites/ grows by one cert per branch ever started, and
# Traefik loads them all. rig-cert rewrites the dynamic config at start, so a
# restart of the watcher is what removes the entry from rig-certs.yaml.
doc proxy-cert-rm "Remove an environment's cert: rig proxy cert-rm <host-base>"
task::proxy-cert-rm() {
  local base="${1-}"
  [ -n "$base" ] || die "usage: rig proxy cert-rm <host-base>   (e.g. vi-pr-123)"
  # The host base is a DNS name, nothing else. Refuse anything that could become a
  # glob or a path. We rm with wildcards below.
  case "$base" in
    *[!a-z0-9.-]* | '' | *..* | .* | -*)
      die "'$base' does not look like a host base (a-z, 0-9, - and .)"
      ;;
  esac
  (
    rig_in_machine_checkout
    local sites="$PROXY_CAROOT/share/sites" n=0 f
    [ -d "$sites" ] || exit 0
    # The cert file is named after the FIRST domain in rig.hosts, i.e. www.<base>.test
    # for a typical site. Match both subdomains and an apex entry.
    for f in "$sites/$base.test"* "$sites"/*".$base.test"*; do
      [ -e "$f" ] || continue
      rm -f "$f"
      n=$((n + 1))
    done
    if [ "$n" -eq 0 ]; then
      log "no cert for $base.test — nothing to do"
      exit 0
    fi
    log "removed $n cert file(s) for $base.test"
    if [ "$(docker container inspect -f '{{.State.Running}}' rig-cert 2>/dev/null)" = "true" ]; then
      docker restart rig-cert >/dev/null \
        && log "restarted rig-cert — rig-certs.yaml is rewritten without them"
    fi
  )
}

doc proxy-cert-clean "Remove generated site and default certs (keeps the root CA)"
task::proxy-cert-clean() {
  (
    rig_in_machine_checkout
    rm -f "$PROXY_CAROOT"/rig-*.pem \
          "$PROXY_CAROOT"/share/sites/*.pem \
          "$PROXY_CAROOT"/share/sites/*.domains \
          "$PROXY_CAROOT"/share/sites/legacy/*.pem \
          "$PROXY_CAROOT"/share/sites/legacy/*.domains \
          ingress/traefik/dynamic/rig-certs.yaml \
          ingress/traefik/dynamic/legacy-certs.yaml
  )
}

# Traefik rereads everything at start. Two things need that: the default cert's
# CONTENT changes without any config file changing (providers.file watches
# /config, not /cert), and `docker network connect` does not give the docker
# provider a full container event, so it keeps the old backend IP and answers
# 504. Own task, so `need` gives exactly ONE restart per rig invocation.
doc proxy-reload "Restart rig-proxy so it rereads certs and backend IPs"
task::proxy-reload() {
  if [ "$(docker container inspect -f '{{.State.Running}}' rig-proxy 2>/dev/null)" != "true" ]; then
    return 0
  fi
  docker restart rig-proxy >/dev/null
  log "restarted rig-proxy — rereads certs and backend IPs"
}

##############################################################################
## MACHINE SETUP (one-time)

# The whole machine setup in ONE command, runnable as `./bin/rig proxy-setup`
# from a fresh clone, before `rig` is even on PATH. The steps already existed
# separately; what was missing was the order between them, and it cannot be guessed:
# the CA must be inherited before proxy-cert creates a new one, the domains added
# before the cert is issued, and DNS after rig-dns runs.
#
# The transition from an earlier machine infrastructure is the same command, not a
# separate one: if the task proxy-legacy-setup (plugin legacy) exists and its
# `detect` says yes, it takes over. It inherits the CA before proxy-cert creates a
# new one and starts the proxy itself. Two paths to document become two paths to
# forget to update. `--fresh` skips it and takes the ingress directly.
#
# Idempotent: rerun at any time. The sudo step is skipped when the resolver is
# already correct, so a rerun is quiet.
doc proxy-setup "One-time per computer: rig on PATH, CA, proxy, DNS, all in one"
task::proxy-setup() {
  local fresh="" legacy=""
  if [ "${1-}" = "--fresh" ]; then
    fresh=1
  fi
  # The requirements we cannot fix for the user (docker, mkcert). Fail on them
  # before we have copied the CA and bound ports.
  ( rig_in_machine_checkout && ./doctor.sh --preflight ) \
    || die "the machine is missing something above — fix it and run 'rig proxy-setup' again"

  echo
  need proxy-cli-setup

  # Unconditional, so before the branch: a machine can have unmigrated sites
  # without having akka-tools next to it (detect then says no), and --fresh skips
  # the branch on purpose. In both cases the network is still needed. No echo of
  # its own: the task is quiet when the network already exists, and the branch
  # below has its own separator.
  if is_task proxy-legacy-network; then
    need proxy-legacy-network
  fi

  echo
  if [ -z "$fresh" ] && is_task proxy-legacy-setup && task::proxy-legacy-setup detect; then
    legacy=1
    need proxy-legacy-setup
  else
    need proxy-up
  fi

  echo
  if dns_test_configured; then
    log "*.test already points to rig-dns (127.0.0.1:5300) — skipping dns-setup (no sudo)"
  elif [ "$(uname)" = "Darwin" ]; then
    log "the next step writes /etc/resolver/test and therefore asks for sudo"
    need proxy-dns-setup
  elif [ "$(uname)" = "Linux" ] && systemctl is-active --quiet systemd-resolved 2>/dev/null; then
    log "the next step writes /etc/systemd/resolved.conf.d/rig-test.conf and therefore asks for sudo"
    need proxy-dns-setup
  else
    log "⚠️  no known resolver mechanism (neither macOS nor systemd-resolved) — point your .test resolver at 127.0.0.1:5300 by hand"
  fi

  echo
  need proxy-doctor

  echo
  log "✅ the machine is ready."
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) log "   restart the shell first (the PATH line was just added): exec \$SHELL -l" ;;
  esac
  log "   new site:     cd <site> && rig setup   (then 'rig up')"
  [ -z "$legacy" ] || log "   unmigrated sites: see rig/plugins/legacy/README.md"
}

# rig-dns is published on 127.0.0.1:5300, not 53 (see compose.yaml). On macOS
# because mDNSResponder already owns *:53 under the Apple Virtualization framework,
# on Linux because NetworkManager/dnsmasq often owns 127.0.0.53:53 (the systemd-
# resolved stub) or simply 127.0.0.1:53 (distro dnsmasq). Both OS mechanisms take
# an explicit port, so the same rig-dns container serves both without touching the
# port binding.
doc proxy-dns-setup "One-time: point *.test DNS at rig-dns on 127.0.0.1:5300"
task::proxy-dns-setup() {
  case "$(uname)" in
    Darwin)
      sudo mkdir -p /etc/resolver
      printf 'nameserver 127.0.0.1\nport 5300\n' | sudo tee /etc/resolver/test >/dev/null
      sudo dscacheutil -flushcache
      sudo killall -HUP mDNSResponder
      ;;
    Linux)
      # Only systemd-resolved is supported. It is the Ubuntu/Fedora default and the
      # only one that takes a custom port in DNS= (since systemd 245). If the machine
      # runs distro dnsmasq directly on 127.0.0.1:53 instead (see
      # docs/status/LINUX_SUPPORT.md) that is a manual configuration, not this
      # task. The two cannot share a generic fix.
      systemctl is-active --quiet systemd-resolved \
        || die "systemd-resolved is not running — point your .test resolver at 127.0.0.1:5300 by hand (see docs/status/LINUX_SUPPORT.md)"
      sudo mkdir -p /etc/systemd/resolved.conf.d
      printf '[Resolve]\nDNS=127.0.0.1:5300\nDomains=~test\n' \
        | sudo tee /etc/systemd/resolved.conf.d/rig-test.conf >/dev/null
      sudo systemctl restart systemd-resolved
      ;;
    *)
      die "dns-setup supports macOS and Linux (systemd-resolved) — point your .test resolver at 127.0.0.1:5300 by hand"
      ;;
  esac
  echo "✅ *.test now resolves to 127.0.0.1 via rig-dns on port 5300 — no /etc/hosts edits"
}

doc proxy-doctor "Check the machine's dependencies and host configuration"
task::proxy-doctor() {
  ( rig_in_machine_checkout && ./doctor.sh )
}

##############################################################################
## RESOURCES
#
# proxy-load reports the resource state without judging it: the host, the Docker
# VM, the containers grouped per compose project and what can be freed.
# Measurements only. A human or agent interprets and chooses an action. Hence no
# thresholds and no action lines here; they belong in the doctor.
#
# Needs no checkout (only docker and sysctl) and therefore works in any directory,
# even where the global rig launcher does not exist.

doc proxy-load "Show the resource state: the host, the Docker VM, containers per stack, freeable"
task::proxy-load() {
  local bar='──────────────────────────────────────'

  printf '── Host %s\n' "$bar"
  if [ "$(uname)" = "Darwin" ]; then
    printf 'cpu:    %s cores\n' "$(sysctl -n hw.ncpu)"
    printf 'memory: %s GB\n' "$(($(sysctl -n hw.memsize) / 1073741824))"
    printf 'load 1/5/15 min: %s\n' "$(sysctl -n vm.loadavg | tr -d '{}' | awk '{ $1 = $1; print }')"
    printf 'swap:   %s\n' "$(sysctl -n vm.swapusage)"
    # The line "System-wide memory free percentage: NN%". The rest of the dump is
    # page statistics that add nothing here.
    command -v memory_pressure >/dev/null \
      && memory_pressure 2>/dev/null | grep 'free percentage' || true
  else
    uptime
    command -v free >/dev/null && free -h || true
  fi

  printf '\n── Docker VM %s\n' "$bar"
  if ! docker info >/dev/null 2>&1; then
    echo 'the docker daemon is not running — the report ends here'
    return 0
  fi
  docker info --format '{{.NCPU}} {{.MemTotal}}' 2>/dev/null \
    | LC_ALL=C awk '{ printf "allocated: %s cpu, %.1f GB memory\n", $1, $2 / 1073741824 }'
  # The host's df cannot see the VM's disk. Measure from inside a container, like the doctor.
  if [ "$(docker container inspect -f '{{.State.Running}}' rig-proxy 2>/dev/null)" = "true" ]; then
    docker exec rig-proxy df -h / 2>/dev/null \
      | awk 'NR == 2 { printf "disk: %s of %s used (%s free, %s)\n", $3, $2, $4, $5 }'
  else
    echo 'disk: not measured — rig-proxy is not running (the VM disk is measured from inside a container)'
  fi

  printf '\n── Containers per compose project %s\n' "$bar"
  local stats
  stats="$(docker stats --no-stream --format '{{.ID}}|{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' 2>/dev/null || true)"
  if [ -z "$stats" ]; then
    echo 'no containers running'
  else
    # stats has no labels. Get the compose project from docker ps and join on
    # container id in awk (P lines = projects, S lines = measurements).
    # cpu is percent of ONE core, so a stack's sum can exceed 100.
    # LC_ALL=C: docker writes a decimal point, and in a comma locale awk stops
    # reading "2.51" at the point. The sums silently go wrong without it.
    {
      docker ps --format '{{.ID}}|{{.Label "com.docker.compose.project"}}' | sed 's/^/P|/'
      printf '%s\n' "$stats" | sed 's/^/S|/'
    } | LC_ALL=C awk -F'|' '
      function tomib(s,  v) {
        v = s + 0
        if (s ~ /TiB/) return v * 1048576
        if (s ~ /GiB/) return v * 1024
        if (s ~ /MiB/) return v
        if (s ~ /KiB/) return v / 1024
        return v / 1048576
      }
      $1 == "P" { proj[$2] = $3; next }
      $1 == "S" {
        p = proj[$2]
        if (p == "") p = "(outside compose)"
        if (!(p in n)) name[++np] = p
        n[p]++
        line[p, n[p]] = sprintf("  %-32s cpu %-8s memory %s", $3, $4, $5)
        cpu[p] += $4 + 0
        split($5, m, " ")
        mem[p] += tomib(m[1])
      }
      END {
        for (i = 1; i <= np; i++)
          for (j = i + 1; j <= np; j++)
            if (mem[name[j]] > mem[name[i]]) { t = name[i]; name[i] = name[j]; name[j] = t }
        for (i = 1; i <= np; i++) {
          p = name[i]
          printf "%s — %d containers, cpu %.1f%%, memory %.0f MiB\n", p, n[p], cpu[p], mem[p]
          for (j = 1; j <= n[p]; j++) print line[p, j]
        }
      }'
  fi

  printf '\n── Freeable (docker system df) %s\n' "$bar"
  docker system df
}

##############################################################################
## BOOTSTRAP
#
# Run `./bin/rig proxy-cli-setup` in the checkout once. Symlink, not a copy, so
# `git pull` updates `rig` directly. ~/.local/bin is not on PATH by default on
# macOS, so the line is added to the shell rc when it is missing. Homebrew's
# /usr/local/bin and /opt/homebrew/bin are avoided on purpose: loose symlinks
# there make `brew doctor` complain.

doc proxy-cli-setup "One-time: put rig on PATH (symlink and shell rc)"
task::proxy-cli-setup() {
  local dest="$HOME/.local/bin" rc line
  mkdir -p "$dest"
  ln -sfn "$RIG_BIN" "$dest/rig"
  echo "✅ $dest/rig → $RIG_BIN"
  case ":$PATH:" in
    *":$dest:"*)
      echo "✅ $dest is already on PATH — try 'rig help'"
      return 0
      ;;
  esac
  case "${SHELL##*/}" in
    zsh) rc="$HOME/.zshrc" ;;
    bash) rc="$HOME/.bashrc" ;;
    *)
      echo "⚠️  unknown shell '$SHELL' — add it yourself: export PATH=\"\$HOME/.local/bin:\$PATH\""
      return 0
      ;;
  esac
  line='export PATH="$HOME/.local/bin:$PATH"'
  if grep -qF "$line" "$rc" 2>/dev/null; then
    echo "✅ the PATH line already exists in $rc — restart the shell"
  else
    printf '\n# Äventyret rig — rig CLI on PATH\n%s\n' "$line" >> "$rc"
    echo "✅ Added $dest to PATH via $rc — restart the shell (or: source $rc)"
    echo "ℹ️  completion: also add 'eval \"\$(rig completion ${SHELL##*/})\"' to $rc"
  fi
}

##############################################################################
## NEW — the only task that runs without a site

doc new "Create a new site: rig new <stack> <name> (requires plugins/<stack>/scaffold/, which no stack has yet)"
task::new() {
  local stack="${1-}" name="${2-}" scaffold f
  if [ -z "$stack" ] || [ -z "$name" ]; then
    die "usage: rig new <stack> <name>  (stacks: $(rig_stacks | tr '\n' ' '))"
  fi
  rig_stacks | grep -qx "$stack" \
    || die "unknown stack '$stack' — available: $(rig_stacks | tr '\n' ' ')"
  scaffold="$RIG_DIR/plugins/$stack/scaffold"
  [ -d "$scaffold" ] \
    || die "scaffold is missing for '$stack' — the templates belong in plugins/$stack/scaffold/ (compose.yaml, rigfile, .env.template, .env.rig)"
  [ -e "$name" ] && die "$name already exists"
  mkdir -p "$name"
  ( cd "$scaffold" && tar cf - . ) | ( cd "$name" && tar xf - )
  # Platform-neutral in-place substitution. `sed -i` cannot be written portably:
  # BSD needs a separate suffix argument (-i ''), GNU needs the suffix attached to
  # the flag, and `grep -Z` means --null on GNU but --decompress on BSD. Hence a
  # line-based loop and a temp file, which works the same everywhere.
  # `grep -rl` exits 1 without matches, and pipefail would have killed the task
  # there. A scaffold without placeholders is not an error. Write back with `cat`
  # and not `mv`: mv would have given the file the temp file's permissions and lost
  # executable bits in the scaffold.
  { grep -rl '__SITE__' "$name" || true; } | while IFS= read -r f; do
    sed "s/__SITE__/$name/g" "$f" > "$f.rig-tmp"
    cat "$f.rig-tmp" > "$f"
    rm -f "$f.rig-tmp"
  done
  # The pin: RIG_SOURCE (development of the rig), otherwise the latest release.
  (
    cd "$name"
    git init -q
    "$RIG_DIR/scripts/rig.sh" setup
    "$RIG_BIN" setup
    "$RIG_BIN" up
  )
  log "✅ $name up at https://www.$name.test"
}
