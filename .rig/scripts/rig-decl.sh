# shellcheck shell=bash
# rig-decl.sh — the ONLY reader of the declaration files: rigfile, plugin.rig
# and the deploy targets (deploy/targets/<target>.rig). Sourced by the runner and by
# rig.sh; both define die and log.
#
#   rig_parse <file> <allowed keys>      validate and set the keys as variables
#   rig_decl_value <file> <KEY>          a key's value, empty if it is missing
#
# rig.sh, rig-pin.sh and the doctor used to read the files with their own sed lines
# that did not strip quotes and took the first occurrence, while the runner
# took the last. The same rigfile could therefore mean two things. So never
# read a declaration file with sed; call rig_decl_value.
#
# The declaration surface must be readable WITHOUT being run: fleet reads it with a
# regex over a remote file (ingest/src/scan.ts:294) and cannot source bash.
# Command substitution is therefore rejected mechanically. The discipline is upheld by
# the tool that runs every day, not by a convention.
#
# LAX=1 → ignore unknown keys (pass 1, before the plugins are known).
# LAX=warn → warn and skip them (the repair path, pass 2: a key can belong
# to a plugin the payload does not have yet).

# An allowed key ending in * matches a prefix (per-service keys such as
# RIG_TARGET_ROOT_<service> in the deploy targets).
key_allowed() {
  local key="$1" a
  for a in $2; do
    case "$a" in
      *'*') case "$key" in ${a%\*}*) return 0 ;; esac ;;
      "$key") return 0 ;;
    esac
  done
  return 1
}

rig_parse() {   # rig_parse <file> <allowed keys>
  local file="$1" allowed=" $2 " line key val n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    case "$line" in '' | '#'*) continue ;; esac
    case "$line" in
      *=*) ;;
      *) die "$file:$n: expected KEY=value, got: $line" ;;
    esac
    key="${line%%=*}"
    val="${line#*=}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    val="${val#\"}"
    val="${val%\"}"
    if ! key_allowed "$key" "$2"; then
      case "${LAX-}" in
        1) continue ;;
        warn)
          # The repair path: the key can belong to a plugin the payload does not
          # have yet, which load_plugin just skipped with a warning, and
          # exactly what 'rig self update' fetches. The same tolerance must apply to
          # the key, otherwise the update is stopped by a declaration that only
          # becomes known in the version you are heading to.
          log "⚠️  $file:$n: unknown key '$key' — skipped; 'rig self update' makes it known if the target version has the plugin"
          continue
          ;;
      esac
      die "$file:$n: unknown key '$key' — allowed: $(printf '%s' "$2" | tr ' ' '\n' | grep -v '^$' | awk '!seen[$0]++' | tr '\n' ' ')"
    fi
    case "$val" in
      *'$('* | *'`'*)
        die "$file:$n: $key contains command substitution — declarations must be readable without being run (fleet parses them)"
        ;;
    esac
    eval "$key=\$val"
  done < "$file"
}

# One value, read with the same rules as rig_parse: quotes are stripped, the last
# occurrence wins, and a broken file is an error (to stderr, empty value,
# status 1). Unknown keys are ignored, so the reader tolerates a manifest from a
# newer version.
rig_decl_value() {   # rig_decl_value <file> <KEY>
  [ -f "$1" ] || return 0
  (
    eval "$2="
    LAX=1 rig_parse "$1" "$2"
    eval "printf '%s\\n' \"\${$2}\""
  )
}
