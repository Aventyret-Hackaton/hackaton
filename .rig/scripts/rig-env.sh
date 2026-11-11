#!/usr/bin/env bash
set -euo pipefail

# rig-env.sh — local resolver for rig:// references in .env content.
#
#   rig-env.sh inject [answer file] [--op-template <file>]
#                                  Read stdin, write stdout: lines whose value
#                                  is rig://<service>/<facet> or
#                                  rig-secret://<service>/<facet> get the value
#                                  from the answer file (default .env.rig in cwd).
#                                  The lookup is mechanical: <SERVICE>_<FACET> in
#                                  uppercase with /- as _ — rig://cms/url →
#                                  CMS_URL, rig://db/host → DB_HOST.
#                                  --op-template names the template stdin came
#                                  from, so that the lines op inject already replaced
#                                  can be recognized and quoted.
#
# Run by `rig env` AFTER op inject. The schemes share the template:
#   op://          secrets with the source of truth in 1Password (same in all environments)
#   rig://         non-secret environment facts (URLs, hosts, ports)
#   rig-secret://  secrets that the environment itself owns (e.g. db/password)
# Locally .env.rig is the backend's answer; on Cloud Run rig-gcloud.sh
# env-sync resolves the same references against the real environment. The template is the whole
# contract; no key-name-based classification anywhere else.
#
# Answer values in .env.rig may contain ${RIG_HOST_BASE} (the site's *.test
# identity: RIG_SITE in the main checkout, <site>-<branchslug> in a linked
# git worktree), expanded here from the environment (`rig env` exports it,
# derived in mk/core.mk). That way the committed .env.rig stays a single
# source of truth that gives the right domains in every worktree.

die() { echo "❌ rig-env: $*" >&2; exit 1; }

# Compose reads the .env files with its dotenv parser, and it INTERPOLATES
# $ sequences in the value: an op-injected salt that happens to contain $ silently
# gets shorter, and the error only shows up as a broken login. ` #` in a value
# is truncated the same way (comment), and whitespace at the edges is trimmed.
#
# The form is double quotes with \, " and $ escaped, not single quotes. Both are
# literal for compose, but the files are read by more than compose: Next reads the same
# content as .env.local, and dotenv-expand expands $ sequences EVEN
# inside single quotes. Escaped double quotes is the only form both parsers
# read literally. (A value that itself contains " gets a leftover
# backslash in Node; no known value has that, and the alternative is worse.)
#
# The quoting only applies to values THE RIG set: the rig:// answers and the lines
# the template fetches from 1Password. Lines the author wrote are passed through
# as is. The template builds composite values with ${VAR}, and quoting would have
# escaped away the interpolation so that `${WP_HOME}/wp` became literal.
#
# A value that is already quoted is left untouched: the template's author
# quoted it, and rig should not second-guess that.
env_needs_quote() {
  case "$1" in
    \'* | \"*) return 1 ;;
    *'$'* | *'#'* | ' '* | *' ' | '	'* | *'	') return 0 ;;
    *) return 1 ;;
  esac
}

env_quote() {
  local v="$1"
  v="${v//\\/\\\\}"
  v="${v//\"/\\\"}"
  v="${v//\$/\\\$}"
  printf '"%s"' "$v"
}

# Lines without an assignment (junk, continuation lines) pass through untouched;
# this script should not have an opinion about them.
#
# Templates align the equals signs, and the alignment spaces belong to
# the line and not to the value: both compose and dotenv trim them before
# stripping quotes. The quoting is therefore placed inside them, otherwise the
# alignment becomes part of the value (`KEY = url` → `KEY=" url"`).
env_requote() {
  local line="$1" k v pad
  case "$line" in *=*) ;; *) printf '%s' "$line"; return ;; esac
  k="${line%%=*}"
  v="${line#*=}"
  pad="${v%%[![:space:]]*}"
  v="${v#"$pad"}"
  if env_needs_quote "$v"; then
    printf '%s=%s%s' "$k" "$pad" "$(env_quote "$v")"
  else
    printf '%s' "$line"
  fi
}

# The keys whose value in the template is fetched from 1Password. `op inject` runs BEFORE
# this script and leaves no trace of which lines it replaced. Without
# the template an injected secret cannot be told apart from a value the template's
# author wrote, and only the former should be quoted.
op_keys_in() {   # <template> → one key per line
  sed -nE 's|^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=.*op://.*|\1|p' "$1"
}

# Secret facets (guardrail): may only be referenced with rig-secret://, so a
# secret can never end up as a literal env in the cloud. Conversely,
# rig-secret:// cannot be used for ordinary facts. Keep in sync with
# RIG_SECRET_FACETS in plugins/gcloud/rig-gcloud.sh.
RIG_SECRET_FACETS="password"

is_secret_facet() {
  case " $RIG_SECRET_FACETS " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

lookup() { # <answer file> <KEY> → the value (quotes stripped, if any)
  local v
  v="$(sed -nE "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*//p" "$1" | head -1)"
  v="${v%"${v##*[![:space:]]}"}"
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
  esac
  printf '%s' "$v"
}

# The whole value must be ONE reference (optionally quoted). Composite values are built
# with ${VAR} interpolation in the consumer, not in the template.
REF_RE="^([[:space:]]*)([A-Za-z_][A-Za-z0-9_]*)([[:space:]]*=[[:space:]]*)[\"']?rig(-secret)?://([a-z][a-z0-9-]*)/([a-z][a-z0-9-]*)[\"']?[[:space:]]*$"

cmd_inject() {
  local envfile="" template="" op_keys=" "
  while [ $# -gt 0 ]; do
    case "$1" in
      --op-template)
        shift
        [ -n "${1:-}" ] || die "--op-template requires a file"
        template="$1"
        ;;
      -*) die "unknown flag: $1" ;;
      *) envfile="$1" ;;
    esac
    shift
  done
  envfile="${envfile:-.env.rig}"
  if [ -n "$template" ]; then
    [ -f "$template" ] || die "$template is missing — --op-template points to the template stdin comes from"
    op_keys=" $(op_keys_in "$template" | tr '\n' ' ')"
  fi
  local line trimmed n=0 seen_any=0 key ref_secret rsvc rfacet lkey value
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n+1)); seen_any=1
    trimmed="${line#"${line%%[![:space:]]*}"}"
    case "$trimmed" in
      ''|\#*) printf '%s\n' "$line"; continue ;;
    esac
    case "$line" in
      *rig://*|*rig-secret://*) ;;
      *)
        key="${line%%=*}"
        key="${key//[[:space:]]/}"
        case "$op_keys" in
          *" $key "*) printf '%s\n' "$(env_requote "$line")" ;;
          *) printf '%s\n' "$line" ;;
        esac
        continue
        ;;
    esac
    [[ "$line" =~ $REF_RE ]] \
      || die "line $n: cannot parse the rig reference: '$line' — expected KEY=rig://<service>/<facet> (the whole value one reference)"
    key="${BASH_REMATCH[2]}"
    ref_secret="${BASH_REMATCH[4]}"
    rsvc="${BASH_REMATCH[5]}"
    rfacet="${BASH_REMATCH[6]}"
    if [ -n "$ref_secret" ]; then
      is_secret_facet "$rfacet" \
        || die "line $n: $key: '$rfacet' is not a secret facet (known: $RIG_SECRET_FACETS) — use rig://$rsvc/$rfacet"
    else
      if is_secret_facet "$rfacet"; then
        die "line $n: $key: '$rfacet' is a secret facet — use rig-secret://$rsvc/$rfacet (otherwise the value becomes a literal env in the cloud)"
      fi
    fi
    [ -f "$envfile" ] \
      || die "$envfile is missing — rig:// references need the local answer file (scaffolded by 'rig self update', or create it by hand)"
    lkey="$(printf '%s_%s' "$rsvc" "$rfacet" | tr 'a-z/-' 'A-Z__')"
    value="$(lookup "$envfile" "$lkey")"
    [ -n "$value" ] \
      || die "line $n: $key: $lkey is missing (or empty) in $envfile — add the line $lkey=<local value>"
    case "$value" in
      *'${RIG_HOST_BASE}'*)
        [ -n "${RIG_HOST_BASE:-}" ] \
          || die "line $n: $key: $lkey in $envfile uses \${RIG_HOST_BASE} but the variable is not set — set RIG_SITE=<site> in the site's rigfile (rig env derives and exports RIG_HOST_BASE)"
        value="${value//\$\{RIG_HOST_BASE\}/${RIG_HOST_BASE}}"
        ;;
    esac
    if env_needs_quote "$value"; then
      value="$(env_quote "$value")"
    fi
    printf '%s%s%s%s\n' "${BASH_REMATCH[1]}" "$key" "${BASH_REMATCH[3]}" "$value"
  done
  # op inject writes nothing at all when it fails in the middle of a pipe; catch it
  # here so `rig env` does not silently produce empty .env files.
  [ "$seen_any" = 1 ] || die "empty stdin — did op inject fail?"
}

case "${1:-}" in
  inject) shift; cmd_inject "$@" ;;
  *) die "usage: rig-env.sh inject [answer file] [--op-template <file>]" ;;
esac
