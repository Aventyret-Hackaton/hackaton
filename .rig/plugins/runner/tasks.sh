# runner — the runner's own interface. Lives in a plugin, not in bin/rig:
# introspection is tasks like everything else, and the runner should own zero task logic.
# Always loaded, so `rig help` and `rig explain` exist outside a site too.

##############################################################################
## HELP + WHERE

# `rig help` — the whole list; `rig help <namespace>` (or `rig <namespace>`
# without a verb, via the dispatch) — only that namespace's tasks.
task::help() {
  local filter="${1-}"
  if [ -n "$SITE_DIR" ]; then
    printf 'rig — %s (level: %s, stack: %s)\n      %s\n' "${RIG_SITE:-?}" "$RIG_LEVEL" "${RIG_STACK:-—}" "$RIG_LEVEL_TEXT"
  else
    printf 'rig — machine infra in %s\n' "$RIG_CHECKOUT"
  fi
  # Group order is an explicit rank, not load order: REQUIRES loads
  # services before the stack that requires them, but help should show the stack first.
  # The rank is set by the loader from KIND (see load_plugin). The runner knows no
  # plugin names, it only sorts.
  local owner entry name shown head desc out rank i n hits=0
  n=${#RIG_OWNERS[@]}
  for rank in 0 1 2 3 4 5 6 7; do
    for ((i = 0; i < n; i++)); do
      [ "${RIG_OWNER_RANKS[$i]}" = "$rank" ] || continue
      owner="${RIG_OWNERS[$i]}"
      out=""
      for entry in ${RIG_DOC[@]+"${RIG_DOC[@]}"}; do
        case "$entry" in
          "$owner|"*)
            name="${entry#*|}"
            desc="${name#*|}"
            name="${name%%|*}"
            if [ -n "$filter" ]; then
              case "$name" in
                "$filter" | "$filter-"*) ;;
                *) continue ;;
              esac
            fi
            hits=$((hits + 1))
            # The list prints the canonical spelling: the first hyphen
            # as a space, except when the head is itself a task (deploy
            # shadows deploy-plan), where only the flat form works.
            shown="$name"
            head="${name%%-*}"
            if [ "$head" != "$name" ] && ! is_task "$head"; then
              shown="$head ${name#*-}"
            fi
            out="$out$(printf '  \033[36m%-24s\033[0m %s' "$shown" "$desc")
"
            ;;
        esac
      done
      if [ -n "$out" ]; then
        printf '\n%s\n%s' "$owner:" "$out"
      fi
    done
  done
  if [ -n "$filter" ] && [ "$hits" = 0 ]; then
    die "no namespace '$filter' — run 'rig help'"
  fi
}

# The space form is canonical (CLI API 2026-09-01): `rig where self update`
# should work just as well as `rig where self-update`, so join two arguments.
rig_task_arg() {   # rig_task_arg <arg1> [arg2]
  if [ $# -ge 2 ]; then
    printf '%s-%s' "$1" "$2"
  else
    printf '%s' "$1"
  fi
}

# Exactly one file defines each task (F7), so the runner can always answer which.
task::where() {
  local e want
  [ $# -ge 1 ] || die "usage: rig where <task>"
  want="$(rig_task_arg "$@")"
  for e in ${RIG_WHERE[@]+"${RIG_WHERE[@]}"}; do
    case "$e" in
      "$want|"*)
        printf '%s\n' "${e#*|}"
        return 0
        ;;
    esac
  done
  die "unknown task '$want'"
}

##############################################################################
## SITES

# The machine's rig sites: directories with a rigfile under cwd or its
# parent (RIG_SITES_DIR overrides the roots). The same discovery as
# the site picker in the runner uses when `rig <task>` runs outside a site.
# The non-interactive path to the same answer.
task::sites() {
  [ $# = 0 ] || die "rig sites takes no arguments (got: $*)"
  local list dir name state root
  list="$("$RIG_DIR/scripts/rig-sites.sh" list 2>/dev/null || true)"
  if [ -z "$list" ]; then
    printf 'no sites found under:\n' >&2
    while IFS= read -r root; do
      printf '  %s\n' "${root/#$HOME/~}" >&2
    done <<EOF
$("$RIG_DIR/scripts/rig-sites.sh" roots 2>/dev/null || true)
EOF
    die "set RIG_SITES_DIR to the folder where the sites live (a colon-separated list works)"
  fi
  while IFS='|' read -r dir name state; do
    [ -n "$dir" ] || continue
    printf '  \033[36m%-24s\033[0m %-34s %s\n' "$name" "${dir/#$HOME/~}" "$state"
  done <<EOF
$list
EOF
}

##############################################################################
## COMPLETION (F16)
#
# Completes what make-completion.sh never could: service names from compose and
# task names from the set actually loaded (not a guess from the files).

# Two levels (CLI API 2026-09-01): position 2 completes flat task names,
# position 3 the verbs in the namespace (`rig self <TAB>` → setup status update),
# and service names after exec/logs. The verbs are derived from `rig tasks` with index/
# substr, not regex: a namespace must not be able to be a regex pattern.
task::completion() {
  local shell="${1:-zsh}"
  case "$shell" in
    zsh)
      cat <<'ZSH'
# rig completion (zsh) — add to your .zshrc: eval "$(rig completion zsh)"
_rig() {
  local -a items
  if (( CURRENT == 3 )); then
    case "${words[2]}" in
      exec|logs)
        items=(${(f)"$(docker compose config --services 2>/dev/null)"})
        ;;
      *)
        items=(${(f)"$(rig tasks 2>/dev/null | awk -v ns="${words[2]}" -F: 'index($1, ns"-")==1 { print substr($1, length(ns)+2) ":" substr($0, length($1)+2) }')"})
        ;;
    esac
    if (( ${#items} )); then
      _describe 'rig' items
      return
    fi
  fi
  items=(${(f)"$(rig tasks 2>/dev/null)"})
  _describe 'rig' items
}
compdef _rig rig
ZSH
      ;;
    bash)
      cat <<'BASH'
# rig completion (bash) — add to your .bashrc: eval "$(rig completion bash)"
_rig() {
  local cur="${COMP_WORDS[COMP_CWORD]}" ns words=""
  if [ "$COMP_CWORD" = 2 ]; then
    ns="${COMP_WORDS[1]}"
    case "$ns" in
      exec|logs) words="$(docker compose config --services 2>/dev/null)" ;;
      *) words="$(rig tasks 2>/dev/null | cut -d: -f1 | awk -v ns="$ns" 'index($0, ns"-")==1 { print substr($0, length(ns)+2) }')" ;;
    esac
  fi
  if [ -n "$words" ]; then
    COMPREPLY=($(compgen -W "$words" -- "$cur"))
  else
    COMPREPLY=($(compgen -W "$(rig tasks 2>/dev/null | cut -d: -f1)" -- "$cur"))
  fi
}
complete -F _rig rig
BASH
      ;;
    *)
      die "unknown shell '$shell' — zsh or bash"
      ;;
  esac
}

# Machine-readable task list for completion: "name:description" per line. The flat
# identities. The space form is spelling, not identity.
task::tasks() {
  local entry name desc
  for entry in ${RIG_DOC[@]+"${RIG_DOC[@]}"}; do
    name="${entry#*|}"
    desc="${name#*|}"
    name="${name%%|*}"
    printf '%s:%s\n' "$name" "$desc"
  done
}

##############################################################################
## REFLECTION
#
# explain lives in the runner, not in core: reflection is the runner's own interface
# and must exist outside a site too (the checkout loads only proxy).

doc_text() {
  local e name
  for e in ${RIG_DOC[@]+"${RIG_DOC[@]}"}; do
    name="${e#*|}"
    case "$name" in
      "$1|"*)
        printf '%s\n' "${name#*|}"
        return 0
        ;;
    esac
  done
}

# Reflection: `rig explain <task>` (or `rig <task> --help`). The registry knows
# which file owns the task (F7), so the source can be shown verbatim, with
# comments and line numbers. `declare -f` exists too, but bash prints its
# *parsed* form: the comments are gone and the quoting normalized. We want to see
# what is in the file, because that is what you edit.
explain_src() {   # explain_src <task> <file>
  awk -v n="$1" '
    !inside {
      if ($0 ~ /^#/ || $0 ~ "^doc "n"( |$)") { buf = buf sprintf("%5d  %s\n", NR, $0); next }
      if ($0 ~ "^task::"n"\\(\\) *\\{") { inside = 1; printf "%s", buf }
      else { buf = ""; next }
    }
    inside {
      printf "%5d  %s\n", NR, $0
      if ($0 ~ /^}/) exit
    }
  ' "$2"
}

# Dependencies (need …) in the task body: from the file when it exists, otherwise from bash's
# parsed form (generated tasks: `need x;` with a trailing semicolon).
explain_deps() {   # explain_deps <task> <file>
  if [ -f "$2" ]; then
    awk -v n="$1" '
      $0 ~ "^task::"n"\\(\\) *\\{" { inside = 1; next }
      inside && $0 ~ /^}/ { exit }
      inside && $1 == "need" { print $2 }
    ' "$2"
  else
    declare -f "task::$1" | awk '$1 == "need" { sub(/;$/, "", $2); print $2 }'
  fi
}

task::explain() {
  local want file
  [ $# -ge 1 ] || die "usage: rig explain <task>"
  want="$(rig_task_arg "$@")"
  file="$(task::where "$want")"
  printf '\033[36m%s\033[0m — %s\n' "$want" "$(doc_text "$want")"
  printf '%s\n\n' "$file"
  # The declaration site is not always a file: instantiated roles (the rig.plugin
  # label in compose) are generated with eval and where points at the label. Then only
  # bash's own picture of the function exists, parsed, without comments.
  local src=""
  if [ -f "$file" ]; then
    src="$(explain_src "$want" "$file")"
  fi
  if [ -n "$src" ]; then
    printf '%s\n' "$src"
  else
    # help/where/explain live in the runner itself, not in a task file.
    printf '(defined in the runner or generated from the declaration — bash parsed form)\n'
    declare -f "task::$want"
  fi
  local dep deps=""
  for dep in $(explain_deps "$want" "$file"); do
    deps="$deps $dep"
  done
  if [ -n "$deps" ]; then
    printf '\nDependencies (need):%s\n' "$deps"
  fi
}

# The runner's own interface is registered here, not in a plugin: it must exist
# outside a site too (where core is not loaded; the checkout is level proxy).
doc help "Show the help — rig help [namespace] (or just rig <namespace>)"
doc where "Show which file defines a task: rig where db seed"
doc tasks "Machine-readable task list (for completion)"
doc completion "Print shell completion: rig completion zsh|bash"
doc explain "Show doc, source code and dependencies for a task"
doc sites "List the machine's rig sites and whether they are up"

