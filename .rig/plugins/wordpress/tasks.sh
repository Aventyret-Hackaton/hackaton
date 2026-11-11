# wordpress — WordPress (Bedrock) in the role cms, headless or classic.
#
# The role's verbs live in the IMAGE (the image contract, docs/decisions/2026-09-02-
# image-contract.md): docker/cms/rig/verbs/{install,build,format,lint,doctor}
# are dispatched by the runner from VERBS= in plugin.rig. `rig cms install` runs
# /rig/verbs/install in a fresh container, the rest in the running one. up/cli
# are generated too. The theme is always built with pnpm; the yarn support (the build
# arg WP_PACKAGE_MANAGER) was removed, see the Dockerfile's header. A second WordPress
# gets the whole family via rig.plugin=wordpress in compose.
#
# What remains here are the FREE verbs, outside the contract's closed list. They are
# host tasks for the default service cms. Theme commands run FROM the theme directory
# (the theme scripts scan relative to cwd); exactly one theme is expected under
# web/app/themes/, otherwise WP_THEME (container env) decides.

# The plugin's private surface (F18): wordpress_… The container's shell expands
# WP_THEME, hence single-quoted.
wordpress_theme_run() {
  need cms-up
  docker compose exec cms sh -c 'cd web/app/themes/${WP_THEME:-*} && pnpm run "$@"' sh "$@"
}

doc cms-wait "Wait until cms accepts connections"
task::cms-wait() {
  need cms-up
  # Limit in seconds. Without it the loop spun forever on a container that
  # never comes up (db-wait has the same pattern with DB_WAIT_TIMEOUT).
  local timeout="${CMS_WAIT_TIMEOUT:-60}" waited=0
  echo "⏳ Waiting for CMS..."
  until docker compose exec cms sh -c 'echo 1' >/dev/null 2>&1; do
    if [ "$waited" -ge "$timeout" ]; then
      die "cms did not respond within ${timeout}s — see \`docker compose logs cms\`"
    fi
    echo "   still waiting..."
    sleep 2
    waited=$((waited + 2))
  done
  echo "✅ CMS is ready!"
}

# Free arguments, which make could not do: rig cms wp plugin list
doc cms-wp "Run wp-cli in the cms container: rig cms wp plugin list"
task::cms-wp() {
  need cms-up
  docker compose exec cms wp --allow-root "$@"
}

doc cms-watch "Watch-build the theme"
task::cms-watch() {
  wordpress_theme_run --if-present dev
}

doc cms-translate "Extract translations"
task::cms-translate() {
  wordpress_theme_run translate
}

doc cms-translate-compile "Compile translations"
task::cms-translate-compile() {
  wordpress_theme_run translate:compile
}

doc cms-create-user "Create/reset the local wpadmin user"
task::cms-create-user() {
  need cms-up
  docker compose exec cms sh -c '
    wp --allow-root user create wpadmin media@aventyret.com --user_pass=wpadmin --role=administrator --quiet || true
    wp --allow-root user update wpadmin --user_pass=wpadmin --role=administrator --skip-email || true
  '
}

doc cms-update-siteurl "Set home/siteurl to WP_HOME"
task::cms-update-siteurl() {
  need cms-up
  docker compose exec cms sh -c '
    wp --allow-root option update home "$WP_HOME"
    wp --allow-root option update siteurl "$WP_HOME"
  '
}

doc cms-update-wp "Update roots/wordpress"
task::cms-update-wp() {
  need cms-up
  docker compose exec cms composer update roots/wordpress
}

doc cms-update-solarplexus "Update the solarplexus plugin"
task::cms-update-solarplexus() {
  need cms-up
  docker compose exec cms composer update wpackagist-plugin/solarplexus
}

doc cms-update-akka "Update aventyret/akka-headless-wp*"
task::cms-update-akka() {
  need cms-up
  local p
  for p in akka-headless-wp akka-headless-wp-ai akka-headless-wp-redirects; do
    docker compose exec cms composer update "aventyret/$p"
  done
}

doc cms-update-deps "composer update in cms"
task::cms-update-deps() {
  need cms-up
  docker compose exec cms composer update
}
