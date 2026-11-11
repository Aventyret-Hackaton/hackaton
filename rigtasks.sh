# Site-owned tasks — plain bash: a `doc` line + a `task::name` function.
# Run `rig help` to see them grouped under "sajten: hackaton".

doc hello "Site's own sanity-check task"
task::hello() {
  echo "hej från ${RIG_SITE}"
}
