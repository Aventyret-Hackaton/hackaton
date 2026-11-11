# Changelog

What a `rig self update` means for the site. Written for whoever updates
(developer or agent), not as the rig's internal history. The file ships with
the payload and lives in the site as `.rig/CHANGELOG.md`. `rig self update`
prints the sections between the old and new pin, and `rig self status` shows
what is pending when the site is behind.

Every PR that changes something a site notices adds a line under
**Unreleased**, under one of three headings: **Added** (new commands, modules,
behaviours), **Changed** (existing things that behave differently) and
**Action required** (something the site must do beyond committing the diff).
Internal rewrites with no effect on the site are not recorded. `rig-release`
(candidate) renames Unreleased to the version and refuses to release an empty
section. Promote publishes the same text as the GitHub Release. Format and
tooling: `rig/scripts/rig-changelog.sh`, the decision in
`docs/decisions/2026-08-30-changelog.md`.

## Unreleased

## 2.38.0 — 2026-10-30

### Action required

- PHP 8.4.15 → 8.4.27 in the wordpress `cms` image, including the `prod`
  stage: the PHP security release of 2026-10-21. After `rig self update`,
  rebuild and deploy; until then production keeps running 8.4.15. A site that
  pins `PHP_VERSION` as a build arg keeps its own version, and one that pinned
  8.4.27 that way can drop the arg.
- GCP sites (vi.se, aventyret-fleet): PRs that are open when the site updates
  keep their preview tags on Cloud Run, since nothing cleans them up any more.
  Remove them by hand after the update:
  `gcloud run services update-traffic <site>-<service> --remove-tags=pr-<nr>,pr-<nr>-<sha7>`.
  The `preview` label can be deleted from the repo.

### Changed

- PR previews in GCP are removed (docs/decisions/2026-10-20-ci-cd-boundary.md §2).
  A PR no longer deploys a trafficless revision to the dev service or posts a
  preview comment. The `dev-deploy` label is the way to put a PR on dev. The
  `preview` label no longer triggers anything.
- The `pr-closed.yml` stub is removed; `rig self update` deletes it from the site.
  PR builds still push `:pr-<nr>` and `:c-<digest>`.
- `rig gcloud revision-env` takes no tag argument any more.

## 2.37.0 — 2026-10-28

### Changed

- `RIG_ARTIFACT=files`: the promote (`release.yml`) attaches the candidate's
  `dist-<service>` tar to the stable GitHub Release as
  `dist-<service>-<YYYY.MM.N>.tar` + `SHA256SUMS`, so a stable release stays
  deployable after the Actions artifact expires. The promote fails if the
  candidate's artifact has already expired.

### Action required

- `RIG_ARTIFACT=files`: let the site's `deploy.yml` fetch stable versions
  (`YYYY.MM.N`) from the release assets (`gh release download`) and PR/RC
  versions from Actions artifacts as before (RELEASE_RECIPES.md §2). A site
  with `RIG_GITHUB_SKIP=release` adds `actions: read` to its own `release.yml`.

## 2.36.0 — 2026-10-23

### Added

- `RIG_ENVIRONMENTS` (`"dev stage prod"` default, or `"dev prod"`) and
  `RIG_ARTIFACT` (`image` default, or `files`) in `rigfile`, with tasks
  `rig ci environments`, `rig ci artifact` and `rig ci export <service> <tag> <out-dir>`.
- `site-pr.yml` supports the `dev-deploy` label (claims the label exclusively
  across open PRs and outputs `deploy_dev=1` and `version=pr-<nr>`). With
  `RIG_ARTIFACT=image` it needs `GCP_PROJECT`; otherwise it warns and does
  not deploy.
- `site-main.yml` builds and RC-tags (`YYYY.MM.N-rc.M`) a `files` site on
  `main` without `MAIN_REGISTRY` or `GCP_PROJECT` (uploading workflow
  artifacts), and outputs `version`, `deploy_stage` and `deploy_dev`. An
  `image` site without a registry still skips the build.
- `rig ci image <service>` prints the prod image name. The workflows use it,
  so the name always comes from `RIG_SITE` in the rigfile.
- A `files` artifact (`dist-<service>-<version>`) holds one tar,
  `dist-<service>.tar`, so file modes survive the artifact zip. The site's
  `deploy.yml` extracts it before syncing.
- The `pr` and `main` stubs get a `deploy-dev` job that calls the site's own
  `.github/workflows/deploy.yml` with `environment: dev` and the built
  `version`: on a PR with `dev-deploy`, and on `main` when no open PR holds
  the label. Vendored only when the site owns `deploy.yml` (not with the
  `deploy` module), since GitHub rejects a workflow whose local reusable
  workflow is missing. `release` does not call `deploy.yml` yet.

### Changed

- A failed dev-warm image (`dev-image` in `site-main.yml`) no longer fails
  the `main` run, so the stub's `deploy-dev` still runs. The image only
  speeds up local `rig up`.
- `rig release next-rc` and `rig release plan` live in the `ci` plugin instead
  of `github`, so sites on Azure DevOps (level `stack`) have the same CalVer
  versioning commands as GitHub sites.

## 2.35.1 — 2026-10-22

### Added

- Podman support without local compose files. On Podman (detected from
  `docker --version`, or `RIG_ENGINE=podman`) the runner adds a generated
  overlay last in `COMPOSE_FILE`: `keep-id:uid=33,gid=33` for the services
  built from the rig's nextjs and wordpress images, so www-data can write to the
  bind mounts, `pull_policy: build` for the same services, so a site's
  `pull_policy: always` does not make Podman pull an image that only exists
  locally, and `networks: default: {}` for podman-compose. `rig doctor`
  checks that it is read. Docker is not affected.
- The proxy stack (rig-proxy, rig-cert, rig-legacy-attach) mounts the engine's
  socket as the engine reports it, instead of `/var/run/docker.sock`: on
  Podman `docker info` (`Host.RemoteSocket.Path`), on Docker the current
  context (`docker context inspect`), so rootless Podman and rootless Docker
  work without a root-owned `/var/run/docker.sock`. Docker Desktop keeps
  `/var/run/docker.sock`. `RIG_DOCKER_SOCK` overrides it. Run `rig proxy up`
  to recreate the containers.
- `rig renovate doctor` checks that the Renovate app reaches the repo, by
  looking for the Dependency Dashboard it opens on its first run. The app is
  installed on selected repos only, so a new site must be added to it.

### Changed

- The cms image builds imagick from a pinned, checksummed source tarball
  instead of `pecl install`. pecl.php.net's REST API answered 504 for hours on
  2026-10-21 and took every cms build down with it, on the day PHP shipped a
  critical security release. Same imagick version (3.8.1) and the same
  extension list as before. `EXTRA_PHP_EXTENSIONS` still goes through pecl.
- `rig db seed-clone` (and thereby `rig db seed` and `rig setup` with a golden
  volume) starts the database again after the copy. It used to leave it
  stopped, so a site task after the seed, such as a WordPress domain rewrite,
  got "Connection refused". A workaround that runs `rig db up` in such a task
  can be removed.

### Action required

- Podman users: remove the untracked `compose.override.yaml` that only set
  `userns_mode: keep-id`, and `networks: default: {}` from `compose.yaml` if it was
  added for Podman. A site's `pull_policy: always` on the rig's images can stay;
  the overlay overrides it on Podman.
- Node 22.20.0 → 22.23.4 in the nextjs `www` and wordpress `cms` images,
  including the `prod` stage: the Node.js security release of 2026-10-21 (two
  TLS certificate hostname-check bypasses, `dns.resolve` truncating names at a
  NUL character, an out-of-bounds write in the Brotli decoder). After
  `rig self update`, rebuild and deploy; until then production keeps running
  22.20.0. Check with `node -v` in the running container.

## 2.35.0 — 2026-10-19

### Added

- Site-specific Renovate rules go in `renovate-site.json`, a preset the site
  creates and owns. `rig self update` adds it to `renovate.json`, which stays
  rig-owned. Before, a site had to take over `renovate.json` and stopped
  receiving new presets. GitHub repos only.

## 2.34.0 — 2026-10-16

### Changed

- A cancelled PR run no longer leaves a failed `pr / build` check behind.
  Renovate labels its PRs right after opening them, which cancelled the first
  run, and the failed check kept Renovate from ever automerging.
- PR builds read the layer cache but no longer write it. The export took
  86 of 228 seconds in vi-se's www build and only helped the next push to
  the same PR.
- A PR service whose build input is unchanged versus base skips the builder
  setup too, not just the build.
- The `pr` stub skips labels other than `preview`. Bots label right after
  opening, which gave three runs per bot PR.

## 2.32.0 — 2026-10-14

### Changed

- Dependency updates move from Dependabot to the central self-hosted Renovate
  in `Aventyret/renovate-config`. `rig self update` writes `renovate.json`
  and removes the rig-owned `.github/dependabot.yml`. `renovate.json` only
  points to the shared presets (`github>Aventyret/renovate-config`, plus
  `:wordpress` for the wordpress stack). Schedule, grouping and credentials
  live there.
- `rig dependabot doctor` is now `rig renovate doctor`. It checks that
  `renovate.json` exists and that `.npmrc` is tracked. The Dependabot secret
  checks are gone.
- `rig self update` hands over to the target version's updater after switching
  the pin. Files outside `.rig/` are written by the new version on the first
  run. This applies to updates from this version onwards.

### Action required

- Run `rig self update` twice when coming from 2.31.0 or older. The first run
  is done by the old updater and leaves a `dependabot.yml` with only
  github-actions and no `renovate.json`. `rig renovate doctor` tells you.
- Commit `renovate.json` and the removed `.github/dependabot.yml`.
- Turn off **Dependabot security updates** under the repo's
  Settings → Advanced Security, otherwise both bots open PRs. Keep
  Dependabot alerts on.
- The repo's Dependabot secrets (`AKKA_PACKAGES_TOKEN`, `ACF_PRO_KEY`,
  `ACF_PRO_URL`) are no longer used and can be removed.

## 2.31.0 — 2026-10-13

### Added

- `.github/dependabot.yml` gets the registry `acf-pro` when a composer.json in
  the site has `connect.advancedcustomfields.com` as a repository. The
  composer entry points to both `github-composer` and `acf-pro`. Before, the
  whole composer update failed with `private_source_authentication_failure`.
- `rig doctor` checks every secret that `dependabot.yml` refers to, not only
  `AKKA_PACKAGES_TOKEN`.

### Action required

- Sites with ACF Pro need two Dependabot secrets: `ACF_PRO_KEY` (the license
  key) and `ACF_PRO_URL` (the site URL the license is registered to). The URL
  is not a secret, but Dependabot rejects the whole file if the password is
  not a secret. Set `ACF_PRO_URL` per repo:
  `gh secret set ACF_PRO_URL --app dependabot`. If a secret is missing,
  Dependabot fails on the whole file, so set them before committing
  `rig self update`.

## 2.30.0 — 2026-10-13

### Changed

- The rig is in English. Everything it prints, its `doc` lines in `rig help`
  and the comments in the files it writes into the site are English. The
  next `rig self update` rewrites the rig's block in `README.md` and the
  `RIG-OWNED` header lines in the workflow stubs and `dependabot.yml`.
  Commit the diff.

- The adoption levels `kontrakt` and `leverans` are now called `contract`
  and `delivery` in `rig help` and `rig self status`. A site plugin with
  `LEVEL=leverans` in its `plugin.rig` still works in this minor version.
  Change it to `LEVEL=delivery`.

- The documents with Swedish names are renamed, for example
  `docs/FELSOKNING.md` to `docs/TROUBLESHOOTING.md` and `docs/REFERENS.md`
  to `docs/REFERENCE.md`. The full list is in
  `docs/decisions/2026-10-13-english.md`.

## 2.29.1 — 2026-10-10

### Changed

- `rig logs` and `rig proxy logs` only follow the log when the output is a
  terminal. In a pipe, in CI or for an agent they print and exit.
  Previously `rig logs www --tail 50` never finished without a tty. `rig logs -f`
  still follows.

- `rig doctor` and `rig proxy doctor` no longer measure how much space
  `docker system prune` would free. `docker system df` computes the size of
  every volume and took over a minute on a machine with a few hundred volumes.
  The check that the Docker VM disk is full remains. `rig proxy load` still
  shows the reclaimable space.

- `rig images` tags each vendored service's image with `rig-ctx-<hash>`, a
  hash of the build context's contents. `rig doctor` compares the container's
  image against that tag instead of against the files' mtime. Previously the
  warning "the build context is newer than the image" stayed after `rig images`
  when the change did not touch the built stage, because a fully cached build
  keeps the image's old timestamp. Images built before the tag are compared on
  time as before, until the next `rig images`.

- `rig doctor` sees the org secret `AKKA_PACKAGES_TOKEN` in the Dependabot store.
  Previously the check only asked the repo's store and warned on every site where
  the secret was set at org level, advising a repo secret. Now an
  org secret that reaches the repo is accepted. It fails when the repo is not selected or when the secret
  is missing entirely. Without org admin GitHub cannot answer, and then the line becomes info
  instead of a warning.

## 2.29.0 — 2026-10-10

### Changed

- `rig self split-compose` and `rig self env-standalone` are removed, and
  the PR workflow no longer has the `standalone` job. The convention remains:
  with a `compose.rig.yaml` the runner sets
  `COMPOSE_FILE=compose.yaml:compose.rig.yaml`. The files for running without
  the rig (`compose.override.yaml`, `.env.standalone`) belong to the site and
  are maintained in the site. Sites without `compose.rig.yaml` are not affected. The decision:
  `docs/decisions/2026-10-10-compose-overlay.md`.

## 2.28.0 — 2026-10-10

### Added

- The reusable workflow `site-release.yml` has outputs: `stable`
  (the CalVer tag that was promoted or pushed), `rc` and `sha`. A job that
  the site chains after `release` reads `needs.release.outputs.stable`. Previously
  there was only `GITHUB_REF_NAME`, which is the branch name when the release runs from
  Actions. The recipes in `docs/RELEASE_RECIPES.md` now use the output and
  describe how the site takes over its `release.yml` with `RIG_GITHUB_SKIP`.

### Changed

- `rig proxy menubar-setup` is removed. The script it installed never existed
  in the rig, so the command always failed. A leftover link in SwiftBar's
  plugin directory can be removed by hand.

- The module `agent` is removed. No site used it. A site that has
  `agent` in `RIG_MODULES` gets the error "unknown plugin" and should remove the word.
- The old command names from before 2.4.0 (`rig rig-update`, `rig seed-import`,
  `rig gh-auth` …) no longer give a signpost to the new name, but
  the error "unknown task". Run `rig help` for the current names.
- Expired rigfile keys (`RIG_LEVEL`, `RIG_CHANNEL`, `RIG_CI_CONTEXT_*`,
  `RIG_CI_RUNTIME_*`, `WP_PACKAGE_MANAGER`) give the error "unknown key" instead
  of a dedicated explanation, and `rig self update` no longer removes
  `RIG_LEVEL` and `RIG_CHANNEL` automatically. Remove the line by hand.
- `rig doctor` runs `rig proxy doctor` first. The machine checks (the daemon,
  disk space, the `rig` network, rig-dns and Docker's address pools) now exist only
  in the machine doctor, so they no longer show up twice. The site doctor
  still stops when the daemon is not running.
- `rig self update` reads the rigfile and the manifests with the same parser as
  the runner. Quotes are stripped and the last occurrence of a key wins.
  Previously a quoted `RIG_MODULES="github gcloud"` could make the update
  skip plugins, while the runner read the line correctly.
- `rig wordpress doctor` is removed. It only checked the build arg
  `WP_PACKAGE_MANAGER`, which no site has left.

## 2.27.0 — 2026-10-08

### Added

- `RIG_GITHUB_SKIP` in the rigfile opts out of individual workflow stubs, by name
  without `.yml` (e.g. `RIG_GITHUB_SKIP=main`). `rig self update` then does not write
  them back, and a rig-owned one is removed. A name that does not exist gives a
  warning. Previously a removed stub came back on every update.

## 2.26.3 — 2026-10-08

### Added

- The CI builds read the repo secret `COMPOSER_AUTH` and merge it on top of
  the workflow's github-oauth. This is the path for Composer licences such as ACF Pro when
  the site does not have `auth.json` in the repo. The value is the same JSON as
  `COMPOSER_AUTH` locally, e.g. `{"http-basic":{"connect.advancedcustomfields.com":{…}}}`.

### Changed

- The cms image's deps step copies Composer's path repositories (vendored packages
  such as `"url": "packages/akka-headless-wp"`) before `composer install`. Previously the
  build failed with "Source path … is not found" as soon as the cms image was built for
  real. Only relative paths within the app are copied. Globs work.

## 2.26.2 — 2026-10-07

### Changed

- cms passes `HTTP_HOST` with the port to PHP when the Host header refers to the same host
  that nginx resolved. The distribution's `fastcgi_params` sets `$host`, which
  drops the port, so WordPress built standalone addresses such as
  `redirect_to=http://localhost/wp/wp-admin/` and the login ended up in the wrong place.
  A Host header that does not match the host gives `$host` as before. Rig mode
  has no port and is not affected.

## 2.26.1 — 2026-10-07

### Changed

- cms nginx sends a relative `Location` on its own slash redirects
  (`absolute_redirect off` instead of `port_in_redirect off`). In standalone
  `localhost:8081/wp/wp-admin` previously went to `http://localhost/wp/wp-admin/`
  and lost the port. In rig mode `https://cms.<site>.test/wp/wp-admin` previously
  went to `http://` and got an extra hop back to https. A site that
  added the same line in `cms/.rig/site-*.conf` can remove that file.

## 2.26.0 — 2026-10-07

### Changed

- `rig setup` no longer runs `pnpm run build` in www. `next dev` compiles on
  demand, so the production build only made setup longer, and failed it when the code
  did not build. That was the case before the image contract; there www build started ending up in
  `RIG_BUILD` and came along into setup. `rig build` and `rig www build` build
  as before. A plugin controls it with `SETUP_BUILD=no` in the manifest.

## 2.25.0 — 2026-10-02

### Added

- The PR workflow gets the `standalone` job: the smoke test that measures that the site can
  be started without the rig. It does nothing in a site that is not split, so
  the fleet is not affected until `rig self split-compose` has been run.

  Two levels. `docker compose config` always runs and takes seconds. It
  catches files that do not combine and rig resources left behind in
  `compose.yaml`. Actually building and starting the stack only happens when the PR touched
  compose, env or `.rig` files, so a lockfile bump does not pay for a
  cold build.

  The promise measured is narrow: the stack starts and responds on localhost. Not that
  the app works. The secrets in `.env.standalone` are CHANGEME, so a 500 is
  a valid response. The job is not required; raise it in rulesets when the first
  site has passed.

- `rig self env-standalone` writes a `.env.standalone` next to each
  `.env.template`. It is the committed way in for a developer without the rig, as
  `rig env` is for rig mode. The values come from `.env.rig` with the rig's
  domains rewritten: the ingress URLs become `http://localhost:<port>` (the same
  ports as `compose.ports.yaml`), the aliases become the service names.

  The command never runs `op inject`. `op://` lines get `CHANGEME`, because
  the files are committed. `rig-secret://` is resolved from `.env.rig` as usual.

- `rig self split-compose` splits a migrated site's `compose.yaml` into
  the standalone form. The command writes `compose.rig.yaml` (the rig's layer),
  `compose.ports.yaml` (the template for `compose.override.yaml`) and
  `compose.yaml.new`, and never touches the original. Review the diff and swap it
  in. `docker compose config` before and after should give identical output.

  Run once per site, when you want the repo to be startable without the rig.
  Step-by-step description in MIGRATE_TO_RIG.md 6b.

- The site's compose can be split into two files: `compose.yaml` that stands on its own
  (no rig infra) and `compose.rig.yaml` with the rig's layer: the rig network,
  the cert volume, `rig.hosts` and the `.test` hostnames. If the overlay exists,
  the runner sets `COMPOSE_FILE` so that both docker compose and the rig's own reader
  see the same file list, and `rig doctor` shows which files apply. The later
  file wins for scalars, the services are unioned.

  Sites without `compose.rig.yaml` are not affected. No `COMPOSE_FILE` is set
  and everything works as before. The split is done per site, at its own pace
  (`docs/decisions/2026-10-02-standalone-compose.md`).

## 2.24.0 — 2026-09-28

### Added

- Linting runs in CI. The Dockerfile's build stage runs `/rig/verbs/lint` between
  install and build, in both roles. It is the same verb as `rig www lint` locally, so
  the site needs neither its own CI job nor a `.env` on the runner.

  The verb skips itself with a line when `package.json` lacks a
  `lint` script, which most themes do. Only sites that have opted into linting
  are affected.

  The trade-off: a lint error now fails the prod build and thereby a hotfix deploy.
  A separate, bypassable CI job would have required compose and `.env` on the runner,
  which are not there.


## 2.23.0 — 2026-09-27

### Added

- `rig deps update` raises the dependencies within their declared ranges and rewrites
  the lockfile, in every role the site has. Per role: `rig www deps-update`,
  `rig cms deps-update` (the theme). The verb lives in the image like install and build, so
  local and CI run the same script.

  It exists because dependabot cannot handle npm on an akka site. Its jobs
  fail on pnpm 11's lockfile verification in the sandbox, and even when they run they
  only touch direct dependencies (`update-subdependencies: false`) while the alerts
  are mostly transitive. Composer is left alone. Dependabot handles it,
  and `composer update` without arguments is a release, not a dependency bump.

  `--latest` is not included: majors should be taken deliberately, one at a time. Run the build after
  the update and read the diff before you commit the lockfile.

- `rig doctor` has a section for Dependabot. It checks that the `.npmrc` next to
  each `.npmrc.template` is tracked in git. Without it Dependabot sees no
  `@aventyret:registry` and looks for the private packages on npmjs.org, which
  fails the whole update and not just them. It also warns about an
  `_authToken` line in the template and asks GitHub for the Dependabot secret when
  `gh` can answer.

### Changed

- `.github/dependabot.yml` watches the theme's npm tree. Bedrock puts the theme's
  `package.json` under `cms/web/app/themes/<theme>/`, and the entry was only written when
  the manifest was at the service's root, so cms never got any npm entry at all.
  The ecosystem can now point to a subdirectory (`DEPENDABOT=npm:web/app/themes/*`
  in `plugin.rig`); a pattern is written as `directories` instead of
  `directory`. The site gets the change on the next `rig self update`.

### Action required

- Take `.npmrc` out of the site's `.gitignore`, remove the `_authToken` line from
  `<service>/.npmrc.template` and commit `<service>/.npmrc`. The file then contains
  only the scope mapping and no secret. The token already comes from
  the image's `/service/.npmrc`: pnpm 11 does not expand `${NPM_TOKEN}` in a
  project-level `.npmrc`, so the line did nothing even locally. `rig doctor`
  tells you when it is not done.

## 2.22.0 — 2026-09-25

### Added

- `.github/dependabot.yml` gets a `registries` block: the npm entries point to
  GitHub Packages, the composer entries to github.com, both using the secret
  `AKKA_PACKAGES_TOKEN`. Dependabot inherits neither `.npmrc` nor `COMPOSER_AUTH`
  from the site's CI, so without a credential the whole update failed, not just the
  private packages, with `private_source_authentication_failure` and
  `git_dependencies_not_reachable` respectively.

### Changed

- The build secret is called `AKKA_PACKAGES_TOKEN` instead of `NPM_TOKEN`. The name
  is on the org secret, not on the env variable: the container still gets
  `NPM_TOKEN`, because `.npmrc` and pnpm read exactly that name. The change makes
  the secret list readable and says what the token actually gives access to:
  GitHub Packages, not npmjs.org, and the same token drives `COMPOSER_AUTH`.
  `NPM_TOKEN` still works as a fallback in `site-pr.yml` and `site-main.yml`,
  so sites can switch at their own pace.

### Action required

- Add `AKKA_PACKAGES_TOKEN` as a **Dependabot** secret in the site's repo
  (`gh secret set AKKA_PACKAGES_TOKEN --app dependabot`). Dependabot has its
  own secret store: a secret under Actions does not reach it, and
  `dependabot.yml` has no fallback syntax. If it is missing the whole
  update fails. The token needs `read:packages` and read access to
  the Aventyret org's private repos.
- Sites with their own `NPM_TOKEN` under **Actions** should move it to
  `AKKA_PACKAGES_TOKEN`, preferably as an org secret. The fallback keeps the build green
  in the meantime, but `NPM_TOKEN` is removed in the next major.

## 2.21.0 — 2026-09-21

### Added

- `rig <task>` outside a site asks which site applies instead of
  dying with `unknown task`. The list shows the site's name, where it is and whether it is
  running. The choice runs the command there through the same path as `rig -C <directory>`, so
  the site's own pin applies. If the machine has only one site the question is skipped. Without
  a tty (CI, agents, scripts, pipes) the error message stays unchanged.
  A prompt nobody sees would hang the run. The command does not move
  the terminal's directory; a child process cannot do that.
- `rig sites` lists the machine's rig sites: name, directory and up/down. Sites
  are directories with a `rigfile` directly under cwd or its parent. If they live
  somewhere else, `RIG_SITES_DIR` points there (colon-separated list). The status
  costs one docker call for the whole list, and without docker running it becomes `?`
  instead of the list failing.
- `${RIG_WORKTREE_SUFFIX}`: a new variable for a multisite site whose compose
  has its own literal brand hosts (not derived from RIG_HOST_BASE, to
  mirror the production domains). Empty on the main checkout, `-<branch-slug>` in
  a worktree. Append it to a literal (e.g.
  `www.arenaide${RIG_WORKTREE_SUFFIX}.test`) and each worktree gets unique
  hosts/certs without the main environment's domains changing. `rig env` writes it
  to `.env` like `RIG_HOST_BASE`. Opt-in: a site that does not reference it
  notices nothing.

### Changed

- `rig self update` and `rig self status` fetch the rig with gh's token when
  `gh` is available: being logged in with `gh auth login` is enough, regardless of whether
  you chose ssh or https as the git protocol. Previously the fetch died silently
  for ssh users on Linux ("could not fetch v…"), because git lacked
  an https credential for github.com. The error message now also points to
  `gh auth setup-git` as a manual way out.

## 2.20.0 — 2026-09-16

### Added

- `rig self update` writes a getting-started block in the site's `README.md`, between
  the markers `<!-- rig:start -->` and `<!-- rig:end -->`: the clone line with the repo's
  name, `rig setup` and `rig up`, the site's addresses from `rig.hosts` and a link
  to the cheat sheet. The content is derived from the site and rewritten on every update,
  so it cannot go stale. The rest of the file belongs to the site and is not touched.
  If the markers are missing, the block is inserted before the first section the first time.
  If someone has deleted the end marker, the file is skipped with a warning.

## 2.19.0 — 2026-09-15

### Changed

- `rig env` only quotes the values it sets itself: the `op://` lines and
  the `rig://` lines. Since 2.17.0 every line whose value contained `$`,
  ` #` or leading/trailing whitespace was quoted, even lines where the template's author wrote
  the whole value, and two things broke in templates with aligned
  equals signs. The alignment's spaces were counted as part of the value, so
  `AKKA_CMS_URL = https://…` became `AKKA_CMS_URL =" https://…"` and the URL got
  a leading space. And `WP_SITEURL = ${WP_HOME}/wp` had its `$`
  escaped, so compose stopped interpolating and the value became literal. Now
  such lines are written as is, and the quoting is placed inside the alignment where it
  is needed. If you already ran `rig env` on 2.17.0 or 2.18.0 with an aligned
  template: run it again, and `.env` is written correctly.

- `rig doctor` no longer warns about `$` sequences that point to a key in
  the same env file. `WP_SITEURL=${WP_HOME}/wp` is intentional compose interpolation,
  and the old advice ("quote the value") broke the site if you followed it.

## 2.18.0 — 2026-09-15

### Added

- Cloud Run revisions get `COMMIT_HASH` set to the commit they run. Locally
  `rig env` has always written it; in the cloud it did not exist, so an app that
  versions its cache on it got an empty key and a new release kept reading
  from the previous version's cache. The value is set by `rig gcloud-revision-env`, that
  is, on every deploy. It is not set via the template, which would have given all
  revisions the same value. Sites that do not read `COMMIT_HASH` notice nothing.

## 2.17.0 — 2026-09-14

### Added

- `rig doctor` reads the env files with the parser compose actually uses for
  them, and warns about what otherwise becomes a silent error. Compose has two
  env_file parsers: the regular one (dotenv) interpolates `$` sequences in the value,
  so an op-injected salt with `$` becomes shorter than it should; `format: raw`
  interprets nothing, so quotes end up in the value and a space around `=`
  stops the whole stack with "failed to parse env_file … contains whitespaces".
  The check reads the `env_file` declaration per file and measures the file against the right
  rules instead of having an opinion about which parser the site should have chosen.

### Changed

- `rig env` quotes the values it writes when compose's dotenv parser would otherwise
  have interpreted them: `$` sequences, ` #`, and leading/trailing whitespace. The form is
  double quotes with escaped characters, because the files are read by more than compose.
  Next reads the same content as `.env.local`, and dotenv-expand expands
  `$` even inside single quotes. Values you already quoted in the template are left
  untouched. That makes `format: raw` on `env_file` unnecessary for new sites; a site
  that already declared raw can stay there, and doctor measures against that parser
  instead.

## 2.16.0 — 2026-09-07

### Added

- The `proxy` network, which unmigrated akka-tools sites share, is created by
  `rig proxy up` and `rig proxy-setup` instead of only by `rig proxy legacy`.
  The network is `external: true` in the legacy sites' compose and no stack owns
  it, so it was silently missing on a machine without an akka-tools checkout next to it,
  after `proxy-setup --fresh`, and after every `docker system prune` (the network is
  unused as long as no legacy site runs). `make up` in such a site then died with
  "network proxy declared as external, but could not be found". Separate task:
  `rig proxy legacy-network`. `rig proxy-doctor` warns when the network is missing.

- `rig doctor` warns about build args that do not reach CI. CI does not build through
  compose and only forwards `EXTRA_*` args, so another argument in
  the site's compose (`PHP_VERSION`, `NODE_VERSION`) applies in dev and never in
  prod, silently until now. The check lists every such argument on a service in
  `RIG_DEPLOY_SERVICES` and says what CI builds with instead (the Dockerfile's
  default), plus arguments the Dockerfile does not declare at all. It warns, it does not fail: a deliberate local argument may exist,
  it just should not look like it applies to production. Separate task: `rig ci-doctor`.

- The aggregate verbs reject arguments. `rig install www` fails instead of
  silently installing everything; the same goes for `rig build` and `rig format`. An
  aggregate verb by definition applies to all roles.
- `rig doctor` counts the Docker daemon's address pools: how many networks the machine
  has room for and how many are taken. Without custom configuration the
  pools suffice for 31 bridge networks on the whole machine, and each site takes at least one
  (`<project>_default`) plus one per agent environment. When they run out,
  `docker compose up` refuses with "all predefined address pools have been fully
  subnetted", an error that does not mention that it concerns the machine and not
  the stack. Doctor warns when three networks remain, fails when they are gone, and says
  which action actually helps: `docker network prune -f` if some network
  is unused, otherwise an extra pool in Docker Desktop.
- the module `agent`: an agent environment that the rig owns, instead of a
  sandbox product. `RIG_MODULES=agent` gives five tasks: `rig agent grant`
  (creates the database user, once per site), `rig agent up`,
  `rig agent shell`, `rig agent web`, `rig agent down`. The agent runs wp-cli and
  `mysql` against the live site from its own container that sits ALONE on a network without
  a gateway: the only way out is an egress proxy with an allowlist (`AGENT_EGRESS_ALLOW`
  in the rigfile adds hostnames), the only way to the database is a bridge, and
  the database user only has SELECT/INSERT/UPDATE/DELETE. No docker socket,
  no published ports. The site's `.env` is NOT yet scoped for the agent
  (next step in `docs/decisions/2026-09-04-agent-sandbox.md`). Therefore do not run it
  on a site whose `.env` carries references to live business systems.
- `AGENT_WEB=1` in the site's rigfile gives the agent a web surface at
  `https://agent.<base>.test` through the rig proxy: the real terminal in
  the browser, in a tmux session that survives the tab being closed. The address
  follows `RIG_HOST_BASE`, so each worktree gets its own without ports and without
  collisions. `rig agent web` shows the address and the login (basic auth,
  generated to `.user/agent-web-credential`). The agent container stays
  alone on the internal network. A sidecar with a fixed upstream carries
  the route in, so the egress guardrail is untouched. The login is not optional:
  the rig proxy listens on the whole network, not just on loopback.

### Changed

- `rig self update` is no longer stopped by a rigfile key that the payload does not
  know. The runner already skipped a plugin the rigfile names but the payload
  lacks (that is exactly what the update fetches), but then died on the plugin's
  keys: a site that added `AGENT_WEB` before it pinned 2.16.0 could neither
  update nor roll back without editing the rigfile by hand. In the repair path
  (`self update`, `self setup`) they now warn instead and are skipped.
  Outside it an unknown key fails as before, so typos are still caught.

- A candidate pin (`RIG_VERSION=2.16.0-rc.1`) is compared against its final version
  instead of against the latest release. A canary site was previously told it was
  behind ("latest release is 2.15.0 — 'rig self update' changes the pin"), followed by
  a changelog excerpt in reverse that listed things the candidate already had.
  The prompt thus pointed backwards, to a release older than what the site was set
  to test. `rig self status` now says that the candidate is waiting for promote, and
  once the version has been promoted, that it is time to switch to it. A bare
  `rig self update` on a candidate pin fails with guidance instead of
  silently switching to the latest final release: a downgrade must be requested by name.

- `rig self setup` can be run in a repo that is not yet set up. It was
  documented as the first-time command but could not run there: without
  a `rigfile` the self-administration plugin was not loaded, so the runner answered
  "unknown task 'self'", and with a `rigfile` without a pin the repair path required
  an already vendored `.rig/`. Now the plugin is always loaded, the repair path
  requires no copy, and the error message when a pin is missing points to a
  command that actually works there. Setup however refuses in an
  aventyret-rig checkout. It also has a compose file (the rig proxy), and a
  rig pinned inside itself is not what anyone means.

- The cleanup of PR previews stops failing on its own revision. Cloud Run refuses
  to delete a service's most recently created revision, and when a PR is closed without
  any other deploy in between, the preview revision IS the latest. So
  `pr-closed` went red every time and buried the real errors. That
  revision is now skipped (without its tags it takes no traffic and scales
  to zero). At the same time the tag removal in Artifact Registry stops swallowing
  gcloud's error message, so a `PERMISSION_DENIED` can be read in the log
  instead of guessed, and a failed tag listing is no longer interpreted as
  "the digest is untagged". That could have deleted an image `main` points to. Lives in
  the reused workflow, so the sites get the fix without `rig self update`.

- **The theme is always built with pnpm.** The build arg `WP_PACKAGE_MANAGER` and the whole
  yarn path are gone from the wordpress image: the yarn installation in `base`,
  the `deps-yarn` stage and the stage selection `FROM deps-${WP_PACKAGE_MANAGER}`, plus
  the branching in the verbs `install`/`build`/`lint`/`format`. No site in
  the fleet built with yarn, and the construction was the only one in the rig where a
  build arg chose a stage instead of a value. That meant the argument,
  which never reached CI (only `EXTRA_*` does), blew up the CI build on a
  missing `pnpm-lock.yaml` instead of giving the wrong version. `rig doctor` speaks
  up if `WP_PACKAGE_MANAGER` remains in the site's compose: `yarn` is an
  error with the migration path printed, any other value a warning about a dead line.

- `rig setup` seeds every database the site has, not just the primary one. Previously
  the seeding was in `RIG_SETUP` and took the default instance; a second database
  required `RIG_SETUP+=(<instance>-seed)` by hand in `rigtasks.sh`, and the
  forgotten line first showed up as an application error against an empty database. Now
  setup fans out over the new registry `RIG_SEED`, which the db plugin adds
  every instance to. A site that already has the line can remove it. It is
  harmless (`need` runs each task once per invocation), but redundant.
  The command to seed a single database is unchanged: `rig db seed` /
  `rig <instance> seed`. There is no bare `rig seed`, because `seed` is
  a namespace the sites own for their own pipelines.
- the dependabot stub: two services that share an ecosystem and both fall back
  to the repo root (the service directory lacks the manifest, the root has it) again give
  ONE entry instead of two with the same `package-ecosystem` and `directory`.
  The duplicate came with `DEPENDABOT_IGNORE` in 2.15.0 and is a configuration error
  that makes GitHub reject the whole `dependabot.yml`. The site then lost all
  its version updates, not just the duplicated entry.

### Action required

- If the site's compose has `WP_PACKAGE_MANAGER` under `cms: build: args:`, remove
  the line. The argument no longer exists in the image, and docker only warns quietly
  about a build arg no stage consumes. If the theme builds with yarn, it also
  needs to be migrated to pnpm first: `pnpm import` reads `yarn.lock` and
  writes `pnpm-lock.yaml`, `resolutions` in `package.json` is renamed to
  `pnpm.overrides`, and a theme that relies on yarn's flat
  `node_modules` works with `node-linker=hoisted` in the theme's `.npmrc`.
  `rig doctor` points out both cases.

## 2.15.0 — 2026-09-03

### Changed

- the dependabot stub: packages that are locked to something else can be excluded from
  version updates (`DEPENDABOT_IGNORE=<eco>:<pattern>` in the plugin's
  plugin.rig, written as `ignore:` in the entry). The first case is wordpress:
  `koodimonni-language/*` is pinned in composer.json to the same version as
  `roots/wordpress`, but dependabot does not see the link and proposed
  the language pack's latest version against an older core, a PR that can never be
  merged. The language now follows core when a human moves it.

## 2.14.0 — 2026-09-03

### Added

- The build arg `EXTRA_MOUNTPOINTS` in the wordpress image (cms): space-separated
  paths under `/service/cms` that are created owned by `www-data` in the image, e.g.
  `web/app/themes/<theme>/node_modules`. A named volume that the site mounts
  inside its bind mount inherits the owner from the image, not from the bind mount,
  so without this the volume became root-owned and `rig setup` failed with EACCES in
  pnpm after `rig prune`. Declared in the site's compose like the other `EXTRA_*`
  (MIGRATE_TO_RIG.md 3g); the ci plugin forwards it automatically.

### Changed

- `rig <instance> <verb> --help` (and `rig explain`) for roles instantiated
  via the `rig.plugin` label in compose: the declaration site is the label, not a
  file, but explain fed awk the text as a file name
  (`awk: can't open file compose: rig.plugin=db on statamic-db`). Now
  bash's parsed form of the generated function is shown and the dependencies (need) are read
  from it.

## 2.13.0 — 2026-09-03

### Added

- `rig db analyze` (and `rig <instance> analyze` for instantiated
  database services): runs `ANALYZE TABLE` on all tables in the site's database,
  so that InnoDB's index statistics are recomputed. An SQL dump carries tables, indexes
  and data but not the statistics, and without them the optimizer plans as if
  the tables were empty. A WordPress term query took 22 s instead of
  65 ms, and the article page 26 s instead of 4 s.

### Changed

- `rig db import` and `rig db seed-refresh` finish with `ANALYZE TABLE`.
  The statistics come along with the datadir copy into the golden volume, so
  `rig db seed`/`seed-clone` get them for free.
- `rig doctor` warns about tables that have rows but indexes without
  cardinality ("N tables lack index statistics — slow queries").
  A warning, not an error: the database works, it is just slow.

### Action required

- Sites with an already imported database run `rig db analyze` once (or
  `rig db seed-refresh`, so that the golden volume also gets the statistics).
  Without it the statistics stay at zero until MariaDB happens to recompute them.

## 2.12.0 — 2026-09-03

### Changed

- `rig doctor`: the role vocabulary check asks for the tasks with the service's
  namespace (`statamic_db-up`), not the raw service name (`statamic-db-up`).
  Every service with a hyphen or dot in its name got a false warning
  "missing …-up …-cli" even though `rig <service> cli` worked.
- `rig up` runs the stack in the foreground, like `docker compose up`: the log in
  the terminal, Ctrl-C stops everything. `rig up -d` gives the old behaviour
  (detached); flags are passed on to compose. `rig dev` is unchanged
  (down + up in the foreground) and is kept until we see which form is used.

## 2.11.0 — 2026-09-03

### Changed

- The image contract, stage 3 (CI parity): `rig ci-build`/`ci-push` build
  the artifacts with the image's own verbs. The Dockerfile's build stage runs
  `/rig/verbs/install` and `/rig/verbs/build`, the same scripts that
  `rig www install|build` and `rig cms install|build` run locally. The verbs
  live in the base stage instead of last in dev; `ci-digest` therefore changes
  for all services, so the first CI run after the update rebuilds instead
  of retagging.
- wordpress: the theme is found with the same rule locally and in CI: exactly one theme
  with package.json under `web/app/themes/`, or `WP_THEME` in the service's
  env. Previously the verbs took the first directory (even without package.json) while CI
  required exactly one; now both fail the same way, with the cause printed.

### Action required

- Rebuild the app images after the update (`rig images`). The verbs in the image
  have changed (the theme rule, offline mode for CI). `rig doctor` reminds you.

## 2.10.2 — 2026-09-02

### Changed

- `rig self update` only writes the files in `.rig/` whose content changed
  (rsync --checksum, without timestamp sync). An untouched Dockerfile context
  keeps its mtime, so `rig doctor` stops warning "the build context is newer than
  the image" after every update (the check compares the files' time with the image's;
  a fully cached `rig images` gives no new image, so the warning remained).

## 2.10.1 — 2026-09-02

### Changed

- `rig self update` compares `.rig/` with the pin the copy came from, not with
  the target version. The update's own diff was listed as "local changes in
  .rig/" on every switch (the fleet rollout's finding on vi.se and Arenagruppen).
  Only real deviations are listed now; if the old pin cannot be fetched
  that is said instead.
- `rig doctor` only counts roles (KIND stack/service) under "Loaded roles
  against compose". The legacy plugin's `attach` runtime warned as serviceless on
  every site.

## 2.10.0 — 2026-09-02

### Added

- The image contract, stage 2: the wordpress role's verbs live in the image.
  `rig cms install|build|format|lint|doctor` runs `/rig/verbs/<verb>` in
  the cms container. The package manager is the image's own: the build arg
  `WP_PACKAGE_MANAGER` in compose becomes `ENV` in the image and the verbs read it
  there. Free verbs (`cms wp`, `watch`, `translate*`, `create-user`,
  `update-*`, `wait`) remain as tasks.

### Changed

- The verb scripts glob the theme directory without touching the argument list. `rig cms
  build` passed the theme path as an argument to the build script in rc.1
  (the techsverige canary's finding).

### Action required

- Remove `WP_PACKAGE_MANAGER=…` from the rigfile. The build arg in compose is enough
  (the line dies with a signpost; `rig self update` only warns).
- wordpress sites rebuild the cms image after the update (`rig images`
  or `rig setup`). The verbs live in the image.

## 2.9.0 — 2026-09-02

### Added

- The image contract, stage 1 (docs/decisions/2026-09-02-image-contract.md):
  the nextjs role's verbs live in the image. `rig www install|build|format|lint|
  doctor` runs `/rig/verbs/<verb>` in the www container (install in a fresh one,
  the rest in the running one). The plugin declares `SERVICE=www` and
  `VERBS=install build format lint doctor` in the manifest, the runner generates
  the dispatch; `rig where www build` points to the script. A site plugin in
  `rigplugins/` gets the same contract with `VERBS=` + `docker/<service>/rig/verbs/`.
  `www-icons`/`www-build-cms` remain as free tasks.

### Changed

- `rig self update` no longer warns "does not exist in the rig" for a
  site plugin in `RIG_MODULES` (`rigplugins/<name>/`). It is not vendored,
  only loaded.

### Action required

- nextjs sites rebuild the www image after the update (`rig images`,
  or `rig setup`). The verbs live in the image, and an image built before
  the update answers "does not implement the verb".

## 2.8.0 — 2026-09-02

### Added

- `rig test`: the aggregate over the roles' tests, symmetric with `rig
  install`/`build`/`format`. A role registers its test task with
  `RIG_TEST+=(<role>-test)` (rigtasks.sh or the plugin's tasks.sh) and
  `rig test` runs all of them. An empty registry is an error, not a silent green. CI can
  call `rig test` as one command without zero tests looking green.

## 2.7.0 — 2026-09-02

### Added

- The plugin `app`: generic `up` and `cli` for site-owned services, only via
  the label `rig.plugin=app` (no default instance). `rig.plugin.shell=sh` for
  images without bash. Add `app` to `RIG_MODULES`, label the service, remove the
  copied `<service>-up`/`<service>-cli` from rigtasks.sh. The site's own verbs
  (install, build, migrate …) stay in the same namespace.

### Changed

- A namespace is shared between a label instance and the site's own tasks:
  the instance provides its verbs, rigtasks.sh adds more alongside. A label on
  the role's default service now dies via the duplicate check ("declared in two
  files") instead of a separate namespace lock.

## 2.6.1 — 2026-09-02

### Changed

- `rig self status`: the service table recognizes label-instantiated
  services. `statamic-db` now shows its owner (db) and its role verbs
  instead of standing ownerless with `up –`.
- The error path recognizes service names with hyphens: `rig statamic-db import`
  points to `rig statamic_db import` (the namespace is the derived form),
  and `rig statamic-db <unknown>` suggests `rig exec` as before.

## 2.6.0 — 2026-09-02

### Added

- Instantiated roles are declared in compose: the label `rig.plugin=db` on a
  service gives the db role's whole verb family under the service's own namespace
  (`statamic-db` → `rig statamic_db import`; `-`/`.` become `_`), with
  the instance's deviations as `rig.plugin.<arg>=<value>` labels
  (`rig.plugin.bin=mysql`, `rig.plugin.volume=cms-db-data`, …).
  `rig where` points to the label, the help groups the instance as a service.
  docs/decisions/2026-09-01-service-namespaces.md.
- All role plugins are instantiable: `rig.plugin=nextjs` gives a second
  frontend the whole www family under its own namespace (`rig admin build`),
  `rig.plugin=wordpress` a second WordPress (deviations such as
  `rig.plugin.package_manager=yarn`), `rig.plugin=redis` a second redis.
  nextjs/wordpress instances join the aggregates. `rig install`, `rig
  build` and `rig format` take all instances.

### Action required

- Sites that call `rig_db_service` in rigtasks.sh (the stage 1 form, 2.5.0)
  move the declaration to labels on the service in compose and remove
  the call. The old call dies with a signpost.

## 2.5.0 — 2026-09-02

### Added

- The db role is instantiable: a site with several database services instantiates
  the whole verb family (up/wait/cli/import/export/the seed tracks/doctor) under its
  own namespace with `rig_db_service <instance> SERVICE=<service> …` in
  rigtasks.sh, e.g. `rig statamic_db import` for a second database.
  The instance gets its own dump (`.user/<instance>-seed.sql.gz`), its own asset in
  the GH prerelease "seeds" and its own golden volume; the default instance (`rig
  db …`) is unchanged. Decision and model:
  docs/decisions/2026-09-01-service-namespaces.md.

### Changed

- `rig db import` unpacks the dump on the host and strips MariaDB 11's
  sandbox line before piping it in. Imports thereby work even against
  MySQL images (which lack gunzip and do not understand the line). No difference
  for MariaDB sites.

## 2.4.1 — 2026-09-01

### Changed

- The `rig help` list writes the space form, the canonical spelling, also
  in the task list itself (`self update`, `db seed-refresh`), except the deploy family
  where only the flat form works (frozen until v2). The identity is unchanged:
  `rig tasks`, `where` and completion write the flat name as before.

## 2.4.0 — 2026-09-01

### Added

- The CLI API is settled ahead of the org rollout
  (docs/decisions/2026-09-01-cli-api.md): the canonical spelling is
  the space form (`rig self update`, `rig db seed`). The space
  only replaces the namespace separator; multi-part verbs keep hyphens
  (`rig db seed-refresh`). `rig <namespace>` without a verb shows the group's help,
  as does `rig help <namespace>`, and `rig where`/`rig explain` accept both
  spellings. Completion completes verbs per namespace
  (`rig self <TAB>`) and service names after `exec`/`logs`.
- `rig exec <service> <command…>`: an explicit escape hatch into the container,
  the same pattern as `rig logs <service>`.
- `rig prune`: the emergency exit when a volume is corrupt. Tears down containers, networks
  and the project's volumes in one sweep (lists first, asks before; `FORCE=1`
  skips the question). The golden db volume and the rig's shared volumes are left,
  so `rig setup && rig up` rebuilds the environment and the database is cloned in
  seconds.
- Two seed tracks with one command each (docs/decisions/2026-09-01-db-seed-tracks.md):
  the dump is the truth, the golden volume a local cache of a finished import.
  `rig db import [dump.sql.gz]` imports raw SQL (without a file the
  seed dump is fetched from GitHub first) and never touches the volume. If the volume is behind,
  a hint about `rig db seed-snapshot` is printed. `rig db seed` clones the golden
  volume (builds it when needed) and never imports; `rig db seed-refresh`
  rebuilds it from the latest GH dump. The dump's lifecycle:
  `rig db download`/`export`/`upload`. (Replaces `rig db-import-dump`;
  `rig db seed` no longer takes a dump file.)

### Changed

- Implicit passthrough (`rig www npm …`) is removed. Run
  `rig exec www npm …`. `rig <role> <verb>` is now always a task, and a
  misspelling fails in the runner instead of inside the container.
- Renamed tasks (old names die with a signpost to the new one):
  `rig-setup`/`rig-update`/`rig-status` → `rig self setup|update|status`,
  `rig-check` → `rig proxy check`, `rig-gcloud-setup` → `rig gcloud setup`,
  the `seed` family → the volume track `rig db seed*` and the dump track `rig db
  import`/`download`/`export`/`upload` (`seed-volume` is called `db-seed-snapshot`,
  `seed-import`/`seed-download` are called `db import`/`db download`,
  `db-export-seed`/`db-upload-seed-to-gh` are called `db export`/`db upload`),
  `gh-auth` → `rig github auth`, `docker` → `rig images`,
  `proxy-clean-certs` → `rig proxy cert-clean`, `cms-composer-update` →
  `rig cms update-deps`, `worktree` → `rig worktree add`. `ci-*` and
  the deploy family are unchanged (the workflow contract, frozen until v2).

### Action required

- Muscle memory and your own scripts: switch to the new names above. The old ones fail
  hard with the new command in the error message. The most common changes:
  `rig rig-update` → `rig self update`, `rig seed` → `rig db seed`,
  `rig www bash` → `rig exec www bash`.

## 2.3.0 — 2026-08-31

### Added

- The release flow in GitHub (the decision in docs/decisions/2026-08-30-site-release-ux.md):
  every merge to main RC-tags the candidate (`YYYY.MM.N-rc.M`) after a successful
  build, and Actions → release → Run workflow promotes a candidate to
  stable CalVer. Empty `rc_tag` = latest RC. The promote retags the same digest
  (no rebuild), creates the stable tag + GitHub Release as a receipt and
  chains the deploy to the targets (empty `targets` = `RIG_RELEASE_TARGETS`) when
  the module `deploy` is on; without the module or targets the release ends at tag +
  Release. A manually pushed CalVer tag works as before and only retags
  the digest. New tasks: `rig release-next-rc` (the next candidate name, e.g.
  for hotfix tagging), `rig release-plan` (RC → stable/sha) and
  `rig release-targets`.
- Production targets can require stable tags: `RIG_TARGET_STABLE_ONLY=1` in
  `deploy/targets/<target>.rig` makes the deploy button and `rig deploy` refuse
  candidate/sha tags there. Only promoted releases (`YYYY.MM.N`) get
  through.

### Changed

- The stub `main.yml` has `contents: write` (the RC tagging pushes git tags)
  and `release.yml` has `workflow_dispatch` inputs (`rc_tag`, `targets`) +
  `contents: write`/`deployments: write`. `rig rig-update` rewrites both.
- The ssh provider sets 755 on the deploy directory: `mktemp` creates
  the extraction directory as 700 and `rsync -a` copied the mode to
  `deployment/<name>/` on the host, so the web server could not reach the release
  (cms-stage at Oderland required `chmod 755` by hand after every deploy
  from a CI runner).

### Action required

- Sites with production targets in `deploy/targets/` should set
  `RIG_TARGET_STABLE_ONLY=1` in the target file, so that only promoted releases can
  be deployed there.

## 2.2.0 — 2026-08-31

### Added

- Deploy targets and provider adapters (module `deploy`): the site declares its
  installations in `deploy/targets/<target>.rig`, and `rig deploy <target> <service>
  <image|tag>` places a built release there via the target's provider. `rig
  running <target>` asks the provider what is running, `rig targets` lists the targets and
  doctor validates the whole chain. The first provider is `ssh` (Oderland,
  Cloudnet, ...): extracts the app directory from the prod image and places it with
  rsync + the site's post-deploy script. The same digest as in the container environments.
- The deploy button in GitHub: sites with the module `deploy` get the stub
  `deploy.yml` (Actions → deploy → Run workflow, inputs `tag` + `targets`;
  empty targets = `RIG_RELEASE_TARGETS`). Rollback is the same button with an older
  tag. The workflow fetches the plan from the rig (`rig deploy-plan`), logs in per
  auth type (not per provider), runs `rig deploy` per target × service and
  registers each deploy as a GitHub Deployment in the target's environment. Targets
  with required reviewers pause for approval.

## 2.1.1 — 2026-08-31

### Added

- `rig proxy-load`: the resource state as plain data. The host (load, swap, memory),
  the Docker VM's allocation and disk, containers grouped per compose project
  and `docker system df`. No thresholds or suggested actions: a human or
  agent interprets and chooses the action.
- `.rig/CHANGELOG.md` (this file): `rig rig-update` prints what is
  new between the old and new pin, `rig rig-status` shows what is pending when
  the site is behind the latest release.

## 2.1.0 — 2026-08-30

Released with the older release flow, before this file existed. The section was
written afterwards.

### Changed

- compose owns per-service facts: the source directory is the label `rig.src` on
  the compose service and the runtime is the service's `build.context`, even for a
  site-owned Dockerfile that uses the rig's stages. `rig ci-digest` reads compose
  from the git tree at the ref, so the base digest sees the base's layout.

### Action required

- Remove `RIG_CI_CONTEXT_<service>` and `RIG_CI_RUNTIME_<service>` from the rigfile:
  the source directory is declared as `labels: rig.src: <directory>` on the service in
  compose, the runtime as `build.context`. Leftover keys fail with
  guidance; `rig rig-update` warns but runs.

## 2.0.1 — 2026-08-31

Misnumbered: tagged after 2.1.0 but sorts below it, so `rig rig-update`
never selects it. The same content was re-released as 2.1.1. Pin that instead.

## 2.0.0 — 2026-08-30

The first pinned release. Everything below is relative to 1.1.0 (the channel tag `v1`).

### Added

- Pinned version: `RIG_VERSION=2.0.0` in the rigfile, and `.rig/` is a committed
  copy of the release's payload (synced from `~/.cache/aventyret-rig/` by
  `rig rig-update`). The site repo builds from a clean checkout without access to
  aventyret-rig. No `RIG_READ_TOKEN` in CI. `rig rig-update 2.1.0-rc.1`
  pins a candidate (canary site).
- `rig rig-status`: the site's resolved model (services with runtime and owner,
  loaded plugins with provenance, adoption level) and the pin against the latest
  release.
- `rig deployments`: what runs where, from GitHub Deployments.
- Plugin layers: `ci` is the build contract (`ci-build`, `ci-push`, `ci-digest`) and
  always follows the stack; `github` is the GitHub flow (stubs, `pr / build`,
  deploy-dev, CalVer retag); `gcloud` (GCP dev hosting) requires `github`.
  The adoption level (contract, stack, delivery) is derived from the stack and modules
  and shown by `rig help`.
- Hotfix builds: a push to `hotfix/*` builds the release image the same way as
  `main` (no deploy to dev).
- No PR preview for bot PRs (dependabot). The build runs, the preview is
  skipped.
- `rig-dns` listens on `127.0.0.1:5300`: independent of the VM backend and without
  a privileged port.

### Changed

- A single long-lived branch, `main` (docs/BRANCH_STRATEGY.md). The stubs are
  `pr.yml`, `pr-closed.yml`, `main.yml` (build once, deploy-dev, GitHub
  Deployment) and `release.yml` (CalVer retag of the same digest, no rebuild).
  `develop.yml` and the release guard are gone; the updater cleans them up.
- One WordPress plugin, `wordpress` (the role `cms`), for both headless and
  classic WP. Replaces `wp` and `headless-wp`. The package manager is chosen with
  `WP_PACKAGE_MANAGER=pnpm|yarn`. Old build contexts
  (`plugins/headless-wp/docker/cms`, `plugins/wp/docker/wp`) are remapped by
  the updater.
- The theme layers are built before composer in the WordPress image's deps step.
- One compose reader (`.rig/scripts/rig-compose.sh`) replaces the eight parsers
  that read compose in different ways; `compose.yaml` is the only source for
  service → runtime.
- The seam compose ↔ rigfile is checked in `rig doctor`, `rig rig-setup` and
  `rig rig-update`, not on every command.
- The akka-tools coexistence (the sidecar `legacy-attach`, `rig proxy-legacy*`)
  is isolated in the plugin `legacy` behind the compose profile `legacy`. The plugin
  is removed when no site references `AKKA_TOOLS` in its compose anymore.
- No moving tags (`v1`, `v1-rc`) and no channels: a site runs exactly the
  release the rigfile pins; the stubs are pinned to the same `@vX.Y.Z`.

### Action required

- Run `rig rig-update`. A vendored `.rig/` from the v1 generation (VERSION +
  MANIFEST) is migrated to a pinned copy; `.rig` is removed from `.gitignore`.
  Review `git status` (`.rig/`, `rigfile`, `.github/`) and commit.
- `RIG_LEVEL` and `RIG_CHANNEL` are removed from the rigfile by the updater. The level
  is derived, the channels were replaced by the pin.
- Sites with `wp` or `headless-wp` in `RIG_STACK` switch to `wordpress`.
- Remove the branch `develop` in the site repo, change the base for open PRs to `main`
  and let the ruleset apply only to `main` (docs/BRANCH_STRATEGY.md).
- Sites that still run alongside akka-tools add `legacy` to
  `RIG_MODULES` (rig/plugins/legacy/README.md).
