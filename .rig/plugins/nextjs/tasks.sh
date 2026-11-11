# nextjs — Next.js frontend in the role www.
#
# The role's verbs live in the IMAGE (the image contract, docs/decisions/2026-09-02-
# image-contract.md): docker/www/rig/verbs/{install,build,format,lint,doctor}
# are scripts the runner dispatches from VERBS= in plugin.rig. `rig www install`
# runs /rig/verbs/install in a fresh container, `rig www build` runs /rig/verbs/build
# in the running one. up/cli are generated too. A second frontend gets the whole
# family via rig.plugin=nextjs in compose.
#
# What remains here are the FREE verbs: akka-specific scripts outside the contract's
# closed list. They are host tasks as before and apply to the default service www.
#
# Package scripts run with pnpm. Sites must have a committed pnpm-lock.yaml
# (migrate with `pnpm import`, then remove package-lock.json).

doc www-icons "Generate icons"
task::www-icons() {
  need www-up
  docker compose exec www pnpm run icons
}

doc www-build-cms "Build the CMS blocks in the frontend"
task::www-build-cms() {
  need www-up
  docker compose exec www pnpm run build:cms
}
