# shellcheck shell=sh
# wp-theme.sh (/rig/lib/) — the theme directory, shared by the verbs (`. /rig/lib/wp-theme.sh`).
# Not a verb (closed list in plugin.rig) and not a script of its own, just a
# function the verbs source, hence no shebang.
#
# wp_theme_dir prints the theme's directory, or fails with the reason on stderr.
# WP_THEME (the service's env) names the directory under web/app/themes/; otherwise
# EXACTLY one theme with package.json is expected there. More is an error: better loud
# than silently building the wrong directory. The rule is the same locally and in CI's
# build stage (which runs the same verbs); before there were two: the verbs took the
# first match, the Dockerfile required exactly one.
wp_theme_dir() {
  if [ -n "${WP_THEME:-}" ]; then
    if [ -d "web/app/themes/$WP_THEME" ]; then
      printf '%s\n' "web/app/themes/$WP_THEME"
      return 0
    fi
    echo "the theme web/app/themes/$WP_THEME (WP_THEME) does not exist" >&2
    return 1
  fi
  _wp_theme=""
  for _wp_d in web/app/themes/*/; do
    [ -f "${_wp_d}package.json" ] || continue
    if [ -n "$_wp_theme" ]; then
      echo "several themes with package.json under web/app/themes/ ($_wp_theme, ${_wp_d%/}) — set WP_THEME in the service env" >&2
      return 1
    fi
    _wp_theme="${_wp_d%/}"
  done
  if [ -z "$_wp_theme" ]; then
    echo "no theme with package.json under web/app/themes/" >&2
    return 1
  fi
  printf '%s\n' "$_wp_theme"
}
