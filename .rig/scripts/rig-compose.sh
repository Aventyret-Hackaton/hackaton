#!/bin/sh
# rig-compose.sh — the rig's only reader of the site's compose files.
#
#   rig-compose.sh [-f file …] services                   service names, one per line
#   rig-compose.sh [-f file …] context  <service>         build.context (empty if none)
#   rig-compose.sh [-f file …] image    <service>
#   rig-compose.sh [-f file …] hostname <service>
#   rig-compose.sh [-f file …] label    <service> <key>   label value (map or list form), e.g. rig.src
#   rig-compose.sh [-f file …] build-args <service> [prefix] KEY=VALUE per line from build.args
#   rig-compose.sh [-f file …] external-volumes           volume names with external: true
#   rig-compose.sh [-f file …] env-files                  file|format per env_file entry
#                                                         (empty format = compose's
#                                                         usual dotenv parsing)
#   rig-compose.sh [-f file …] table                      service|context|image|hostname|rig.hosts
#   rig-compose.sh [-f file …] plugins                    service|plugin|ARG=val … for
#                                                         services with a rig.plugin label
#                                                         (rig.plugin.<arg> → ARG, uppercase)
#
# Without -f, the first that exists of compose.yaml, compose.yml,
# docker-compose.yml, docker-compose.yaml is read (compose's own order), and AFTER THAT
# compose.rig.yaml if it exists, the rig's overlay
# (docs/decisions/2026-10-10-compose-overlay.md). The same file list the runner
# gives docker compose via COMPOSE_FILE, so the reader and compose see the same stack.
#
# `-f` can be repeated and reads exactly the given files, in order, without
# looking for the overlay. That is intentional: ci-digest feeds the compose file from a
# git tree (`-f -` reads stdin) and must see the tree's content, not
# the working tree's. CI only asks for context, rig.src and build-args, and they
# live in the base file.
#
# The merge semantics follow compose: a LATER file wins for scalars (hostname,
# image, build.context, individual labels), the service list is the union in the order
# the services first appeared. That is why everything is accumulated and printed in END.
#
# Deliberately text-based parsing, not `docker compose config`: config requires
# the whole file to evaluate (env_file/.env, interpolation, sometimes docker),
# which exists neither on a CI runner nor when .env is exactly what is missing
# (doctor). The price is ONE format assumption, here and nowhere else: two
# spaces per level (the convention of the scaffold and all rig sites). Values
# with `$` in build-args are skipped with a warning; outside compose there is
# no environment to interpolate them in.

set -eu

files=""
while [ "${1-}" = "-f" ]; do
  [ -n "${2-}" ] || { echo "rig-compose: -f requires a file" >&2; exit 1; }
  files="$files$2
"
  shift 2
done
q="${1:?usage: rig-compose.sh [-f file …] <services|context|image|hostname|label|build-args|external-volumes|env-files|table|plugins> ...}"
shift
svc="${1-}"
key="${2-}"

if [ -z "$files" ]; then
  for f in compose.yaml compose.yml docker-compose.yml docker-compose.yaml; do
    if [ -f "$f" ]; then
      files="$f
"
      break
    fi
  done
  [ -n "$files" ] || exit 0
  # The rig's overlay is read last and therefore wins for scalars.
  if [ -f compose.rig.yaml ]; then
    files="${files}compose.rig.yaml
"
  fi
fi

# The file list into the positional parameters; awk takes the files as trailing args and
# runs the same program over them in turn.
set --
OLDIFS="$IFS"
IFS='
'
for f in $files; do
  if [ "$f" = "-" ]; then
    set -- "$@" /dev/stdin
  else
    set -- "$@" "$f"
  fi
done
IFS="$OLDIFS"

case "$q" in
  services | external-volumes | env-files | table | plugins) ;;
  context | image | hostname)
    [ -n "$svc" ] || { echo "rig-compose: $q requires <service>" >&2; exit 1; } ;;
  label)
    [ -n "$svc" ] && [ -n "$key" ] || { echo "rig-compose: label requires <service> <key>" >&2; exit 1; } ;;
  build-args)
    [ -n "$svc" ] || { echo "rig-compose: build-args requires <service> [prefix]" >&2; exit 1; } ;;
  *) echo "rig-compose: unknown query '$q'" >&2; exit 1 ;;
esac

awk -v q="$q" -v want="$svc" -v key="$key" '
  # Strip quotes and trailing whitespace/comment from a value.
  function val(s) {
    sub(/[[:space:]]+#.*$/, "", s)
    sub(/[[:space:]]+$/, "", s)
    gsub(/^["\047]|["\047]$/, "", s)
    return s
  }
  # KEY: value  or  - KEY=value  →  KEY=value (the first separator decides).
  function kv(s,   k, v) {
    if (s ~ /^- /) {
      sub(/^- +/, "", s)
      k = s; sub(/=.*$/, "", k)
      v = s; sub(/^[^=]*=/, "", v)
    } else {
      k = s; sub(/:.*$/, "", k)
      v = s; sub(/^[^:]*:[[:space:]]*/, "", v)
    }
    return k "=" val(v)
  }
  # An env_file entry is complete only when the next line shows that it ended:
  # the `- path:` form carries its format on the LINE AFTER. Hence pending state and
  # a flush at every level change. Dedup: the same file is shared by several services, and
  # by several files in the list.
  function ef_flush() {
    if (ef_file != "" && q == "env-files" && !((ef_file "|" ef_fmt) in ef_seen)) {
      ef_seen[ef_file "|" ef_fmt] = 1
      print ef_file "|" ef_fmt
    }
    ef_file = ""; ef_fmt = ""
  }
  # `env_file: [a, b]` — the inline list has no format, that form does not
  # take one.
  function ef_inline(s,   n, i, parts) {
    gsub(/^[[:space:]]*\[|\][[:space:]]*$/, "", s)
    n = split(s, parts, ",")
    for (i = 1; i <= n; i++) {
      ef_flush()
      ef_file = val(parts[i])
      sub(/^[[:space:]]+/, "", ef_file)
    }
    ef_flush()
  }
  # The service fields are stored instead of printed: a later file in
  # the list must be able to override them. An empty value never overwrites a set one;
  # the overlay only declares what it changes.
  function flush(   i) {
    ef_flush()
    if (svc != "") {
      if (!(svc in seen)) { seen[svc] = ++nsvc; order[nsvc] = svc }
      i = seen[svc]
      if (ctx   != "") t_ctx[i]   = ctx
      if (img   != "") t_img[i]   = img
      if (host  != "") t_host[i]  = host
      if (hosts != "") t_hosts[i] = hosts
      if (lbl   != "") t_lbl[i]   = lbl
      if (plug  != "") { t_plug[i] = plug; t_pargs[i] = pargs }
    }
    svc = ""; ctx = ""; img = ""; host = ""; hosts = ""; lbl = ""; plug = ""; pargs = ""
  }
  # Every new file starts outside all sections; otherwise a file that
  # begins with comments would inherit the section of the previous file.
  FNR == 1 { flush(); section = ""; vol = "" }
  /^[^[:space:]#]/ {
    flush()
    section = $0; sub(/:.*$/, "", section)
    vol = ""
    next
  }
  section == "services" {
    if ($0 ~ /^  [^[:space:]#-][^:]*:[[:space:]]*$/) {
      flush()
      svc = $1; sub(/:$/, "", svc)
      block = ""; sub2 = ""
      next
    }
    if (svc == "") next
    if ($0 ~ /^    [^[:space:]]/) {
      ef_flush()
      block = $0; sub(/^    /, "", block); sub(/:.*$/, "", block)
      sub2 = ""
      if (block == "env_file") {
        s = $0; sub(/^    env_file:[[:space:]]*/, "", s)
        if (s ~ /^\[/) ef_inline(s)
        else if (val(s) != "") { ef_file = val(s); ef_flush() }
      }
      if (block == "image")    { s = $0; sub(/^    image:[[:space:]]*/, "", s); img = val(s) }
      if (block == "hostname") { s = $0; sub(/^    hostname:[[:space:]]*/, "", s); host = val(s) }
      next
    }
    if ($0 ~ /^      [^[:space:]]/) {
      if (block == "env_file") {
        ef_flush()
        s = $0; sub(/^      -[[:space:]]*/, "", s)
        if (s ~ /^path:/) sub(/^path:[[:space:]]*/, "", s)
        ef_file = val(s)
        next
      }
      if (block == "build") {
        sub2 = $0; sub(/^      /, "", sub2); sub(/:.*$/, "", sub2)
        if (sub2 == "context") { s = $0; sub(/^      context:[[:space:]]*/, "", s); ctx = val(s) }
        next
      }
      if (block == "labels") {
        s = $0; sub(/^      /, "", s)
        pair = kv(s)
        k = pair; sub(/=.*$/, "", k)
        v = pair; sub(/^[^=]*=/, "", v)
        if (k == "rig.hosts") hosts = v
        if (k == "rig.plugin") plug = v
        if (k ~ /^rig\.plugin\./) {
          a = substr(k, 12)
          pargs = (pargs == "" ? "" : pargs " ") toupper(a) "=" v
        }
        if (q == "label" && svc == want && k == key) lbl = v
        next
      }
      next
    }
    if ($0 ~ /^        [^[:space:]]/ && block == "env_file") {
      s = $0; sub(/^        /, "", s)
      if (s ~ /^format:/) { sub(/^format:[[:space:]]*/, "", s); ef_fmt = val(s) }
      if (s ~ /^path:/)   { sub(/^path:[[:space:]]*/, "", s);   ef_file = val(s) }
      next
    }
    if ($0 ~ /^        [^[:space:]]/ && block == "build" && sub2 == "args") {
      if (q == "build-args" && svc == want) {
        s = $0; sub(/^        /, "", s)
        pair = kv(s)
        k = pair; sub(/=.*$/, "", k)
        v = pair; sub(/^[^=]*=/, "", v)
        if (key != "" && index(k, key) != 1) next
        if (v ~ /\$/) {
          printf "rig-compose: skipping %s — $ values cannot be interpolated outside compose\n", k > "/dev/stderr"
          next
        }
        if (pair in ba_seen) next
        ba_seen[pair] = 1
        print pair
      }
      next
    }
    next
  }
  section == "volumes" && q == "external-volumes" {
    if ($0 ~ /^  [^[:space:]#]+:/) { vol = $1; sub(/:$/, "", vol); next }
    if (vol != "" && $0 ~ /^    external:[[:space:]]*true/) {
      if (!(vol in v_seen)) { v_seen[vol] = 1; print vol }
      vol = ""
    }
  }
  END {
    flush()
    for (i = 1; i <= nsvc; i++) {
      s = order[i]
      if (q == "services") print s
      if (q == "table")    print s "|" t_ctx[i] "|" t_img[i] "|" t_host[i] "|" t_hosts[i]
      if (q == "context"  && s == want) print t_ctx[i]
      if (q == "image"    && s == want) print t_img[i]
      if (q == "hostname" && s == want) print t_host[i]
      if (q == "label"    && s == want) print t_lbl[i]
      if (q == "plugins"  && t_plug[i] != "") print s "|" t_plug[i] "|" t_pargs[i]
    }
  }
' "$@"
