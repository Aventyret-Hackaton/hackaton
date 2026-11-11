# rig — the rig's self-administration. Separate from plugin site: these tasks
# operate on the .rig/ vendoring, never on the site's stack. You touch them at
# onboarding and when updating, not in daily work. The repo's
# GitHub settings (branch rules) live in plugin github.

##############################################################################
## THE PIN (.rig → pinned version, scripts/rig.sh)
#
# The updater runs from the version the site is pinned to (.rig/scripts/rig.sh,
# or the checkout's when .rig is still a vendored copy, see the runner's
# bootstrap). It changes the pin by fetching the target version and running ITS hooks.

doc self-setup "First time: pin the rig in rigfile and link .rig: rig self setup [version|path]"
task::self-setup() {
  "$RIG_DIR/scripts/rig.sh" setup "$@"
}

doc self-update "Change the pin (default: latest release) and rewrite what the rig owns outside .rig: rig self update [version|path]"
task::self-update() {
  "$RIG_DIR/scripts/rig.sh" update "$@"
  # The compose ↔ rigfile seam is checked here and in setup/doctor. A moved
  # runtime shows up after an update. Never a hard error here:
  # the update is already done and the error should be pointed out, not hide the outcome.
  rig_seam_problems | while IFS='|' read -r ctx what fix; do
    [ -n "$ctx" ] || continue
    printf '⚠️  compose: %s — %s\n   fix: %s\n' "$ctx" "$what" "$fix" >&2
  done
}


# printf %-Ns counts BYTES and some text is multibyte (—, ✓). Pad on
# characters instead (wc -m follows the UTF-8 locale) so the columns line up.
rig_pad() {   # rig_pad <text> <width>
  local s="$1" n
  n="$(printf '%s' "$s" | wc -m | tr -d ' ')"
  while [ "$n" -lt "$2" ]; do
    s="$s "
    n=$((n + 1))
  done
  printf '%s' "$s"
}

# The service table: the compose file is the source (rig_compose table; docker or
# .env is not required). Runtime = build.context (or image), the owner = the plugin
# that declares <namespace>-up (looked up in RIG_DOC). The namespace is derived from
# the service name as in load_instance: - and . become _, so a label-instantiated
# service (statamic-db → statamic_db) shows its owner and its verbs.
rig_status_services() {
  local rows svc ns ctx img runtime owner verbs e
  rows="$(rig_compose table | cut -d'|' -f1-3)"
  if [ -z "$rows" ]; then
    return 0
  fi
  printf '\n  %s %s %s %s\n' "$(rig_pad 'service' 9)" "$(rig_pad runtime 37)" "$(rig_pad 'owner' 14)" 'role verbs'
  printf '%s\n' "$rows" | while IFS='|' read -r svc ctx img; do
    [ -n "$svc" ] || continue
    if [ "$ctx" = . ]; then
      runtime="(own build)"
    elif [ -n "$ctx" ]; then
      runtime="$ctx"
    elif [ -n "$img" ]; then
      runtime="image: $img"
    else
      runtime="?"
    fi
    ns="$(printf '%s' "$svc" | tr '.-' '__')"
    owner="—"
    for e in ${RIG_DOC[@]+"${RIG_DOC[@]}"}; do
      case "$e" in
        *"|$ns-up|"*)
          owner="${e%%|*}"
          ;;
      esac
    done
    case "$owner" in
      "plugin: "*)
        owner="${owner#plugin: }"
        owner="${owner%% (*}"
        ;;
      "site: "*) owner="site" ;;
      "service: "*)
        # Instance via the rig.plugin label: the owner is the role plugin.
        owner="${owner##*plugin: }"
        owner="${owner%)}"
        ;;
    esac
    if is_task "$ns-up"; then
      verbs="up ✓"
    else
      verbs="up –"
    fi
    if is_task "$ns-cli"; then
      verbs="$verbs  cli ✓"
    else
      verbs="$verbs  cli –"
    fi
    printf '  %s %s %s %s\n' "$(rig_pad "$svc" 9)" "$(rig_pad "$runtime" 37)" "$(rig_pad "$owner" 14)" "$verbs"
  done
}

# The provenance is recorded by load_plugin in RIG_PLUGIN_META: which rigfile key
# (or whose REQUIRES) pulled in each plugin. The table answers
# "why is this loaded?" without reading rigfile, compose and the manifests.
rig_status_plugins() {
  local e name label via rest
  printf '\n  %s %s %s\n' "$(rig_pad plugin 14)" "$(rig_pad kind 20)" 'selected via'
  for e in ${RIG_PLUGIN_META[@]+"${RIG_PLUGIN_META[@]}"}; do
    name="${e%%|*}"
    rest="${e#*|}"
    label="${rest%%|*}"
    via="${rest#*|}"
    printf '  %s %s %s\n' "$(rig_pad "$name" 14)" "$(rig_pad "$label" 20)" "$via"
  done
}

doc self-status "Show the site's resolved model (services, plugins, provenance) + pin vs latest release"
task::self-status() {
  # The plugin is loaded outside a site too, so that `rig self setup` exists where it
  # is needed (issue #49). The model, however, does not exist without a rigfile. The service
  # table reads compose through the site plugin, which is not loaded here. Say
  # what is missing instead of failing on an unloaded function.
  if [ -z "$SITE_DIR" ]; then
    "$RIG_DIR/scripts/rig.sh" status
    return 0
  fi
  printf 'rig: level %s, stack %s, modules %s\n     %s\n' \
    "$RIG_LEVEL" "${RIG_STACK:-—}" "${RIG_MODULES:-—}" "$RIG_LEVEL_TEXT"
  rig_status_services
  rig_status_plugins
  echo
  "$RIG_DIR/scripts/rig.sh" status
}

