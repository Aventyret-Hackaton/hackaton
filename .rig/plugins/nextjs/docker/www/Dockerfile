# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv
# (the skip: NPM_TOKEN="" is an intentionally empty default. Real tokens come
# as BuildKit secrets and never end up in an image layer.)
# Stages:
#   base      the dev image (Next dev server behind nginx), what compose builds
#   deps      pnpm store filled from the lockfile alone (perfect cache layer)
#   dev-warm  base + warm pnpm store → GHCR (fast bootstrap for dev/agents)
#   build     source code + the image's verbs: /rig/verbs/install (offline), lint, build
#   prod      slim Next standalone runner → Cloud Run / the client's registry
#   dev       alias for base, LAST in the file: builds without --target (the sites'
#             compose) get the dev image and never touch the app context
#
# deps/build/prod are built by the ci plugin (rig ci-build) and require a named build
# context with the app's source code:  docker buildx build --build-context app=./www ...
#
# RIG_BASE_IMAGE: CI points it at the prebuilt rig base image (published
# by aventyret-rig, tagged with the content hash of the runtime directory, see
# scripts/rig-base-image.sh) so the base-build stage is never built per site.
# Without the build arg (local dev via compose) FROM resolves the stage name and
# base-build is built locally as usual.
ARG RIG_BASE_IMAGE=base-build
ARG NODE_VERSION=22.23.4
FROM node:${NODE_VERSION}-bookworm-slim AS base-build

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl bash nginx tini libcap2-bin \
  && rm -rf /var/lib/apt/lists/*

# Let nginx bind 443 as non-root on any host. Docker Desktop already allows it
# (ip_unprivileged_port_start=0); Podman and native Linux keep the 1024 default,
# so the file capability is needed there (same as the cms image).
RUN setcap 'cap_net_bind_service=+ep' /usr/sbin/nginx

# Enable pnpm via Corepack (bundled with Node).
# - COREPACK_HOME must be an explicit fixed path: the default is $HOME/.cache,
#   which is /root at build time but /service at runtime (www-data) — the
#   prepared pnpm would be invisible and corepack would re-download on every
#   container start.
# - COREPACK_DEFAULT_TO_LATEST=0 pins projects without a packageManager field
#   to the prepared version instead of resolving "latest" over the network.
ARG PNPM_VERSION=11.10.0
ENV COREPACK_HOME=/service/.corepack
ENV COREPACK_DEFAULT_TO_LATEST=0
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /service/www
ENV PNPM_HOME=/service/.pnpm
ENV PNPM_CONFIG_STORE_DIR=/service/.pnpm-store
ENV HOME=/service/

# /service/.pnpm-store must exist owned by www-data: a fresh named volume
# mounted there inherits the mountpoint's owner, and a missing dir would make
# docker create it as root (EACCES for pnpm).
RUN mkdir -p /etc/nginx/cert /run/nginx /var/lib/nginx /var/log/nginx /service/www/node_modules /service/www/.next /service/.pnpm /service/.pnpm-store \
 && chown -R www-data:www-data /service /run/nginx /var/lib/nginx /var/log/nginx /etc/nginx/cert /service/www/node_modules /service/www/.next /service/.pnpm /service/.pnpm-store

COPY --chown=www-data:www-data config/default.conf /etc/nginx/conf.d/default.conf
COPY --chown=www-data:www-data config/nginx.conf   /etc/nginx/nginx.conf
COPY --chown=www-data:www-data config/init.sh      /service/
# $HOME/.npmrc is the one location both npm and pnpm read (pnpm ignores npm's
# global /usr/local/etc/npmrc, and pnpm 11 no longer expands ${NPM_TOKEN} in
# project-level .npmrc — user-level is required for the auth token).
COPY --chown=www-data:www-data config/npmrc /service/.npmrc

USER www-data

EXPOSE 8080
ENV NEXT_PORT=3000
ENV PORT=8080
ENV HOST=0.0.0.0
# Trust the rig's mkcert CA (mounted via the shared rig-cert volume) instead
# of disabling TLS verification wholesale.
ENV NODE_EXTRA_CA_CERTS=/rig/cert/rootCA.pem
# tini as PID1 reaps the Next dev server; no ENTRYPOINT wrapper needed (it only
# exec'd the CMD and didn't even guarantee tini on `docker run … <cmd>`).
CMD ["tini", "--", "/service/init.sh"]

# base = base-build locally, or the prebuilt image in CI (same content).
FROM ${RIG_BASE_IMAGE} AS base

# Site deviations without a .rig patch: extra apt packages as a build arg from the
# site's compose (the ci plugin passes EXTRA_* args to CI builds). Lives in
# base, not base-build, so the addition is applied on top of the prebuilt
# image in CI too, where base-build is never built.
ARG EXTRA_APT_PACKAGES=""
USER root
RUN set -eux; \
    if [ -n "$EXTRA_APT_PACKAGES" ]; then \
        apt-get update; \
        apt-get install -y --no-install-recommends $EXTRA_APT_PACKAGES; \
        rm -rf /var/lib/apt/lists/*; \
    fi
USER www-data

# The image contract: the role's verbs as scripts in the image (rig <service> install|build|
# format|lint|doctor runs them, docs/decisions/2026-09-02-image-contract.md).
# Lives in base, not in dev: CI's build stage runs the same install and build verbs
# as the local command (stage 3, CI parity), and the base image in CI is
# prebuilt up to and including base-build, so the verbs always follow the runtime directory.
COPY --chown=www-data:www-data rig/verbs/ /rig/verbs/

##############################################################################
## CI stages (the ci plugin) — require --build-context app=<the app's source dir>

# deps: only lockfiles are copied. `pnpm fetch` fills the store from the lockfile
# alone, so the layer is invalidated only when the lockfile changes. NPM_TOKEN comes as
# a BuildKit secret (never in an image layer); empty default so public sites
# build without a token despite ${NPM_TOKEN} in .npmrc.
FROM base AS deps
ENV NPM_TOKEN=""
COPY --from=app --chown=www-data:www-data package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN pnpm fetch

# dev-warm: today's dev image with a warm pnpm store at the default path.
# Named volumes are seeded by Docker from the image's content when the volume is empty,
# so a fresh agent environment gets warm caches for free; existing volumes are untouched.
FROM base AS dev-warm
COPY --from=deps --chown=www-data:www-data /service/.pnpm-store /service/.pnpm-store

# build: full source code, then the image's own verbs, the same scripts that `rig www
# install`, `rig www lint` and `rig www build` run locally. RIG_VERB_OFFLINE
# tells the install verb to resolve only against the store from deps (pnpm
# --offline): CI must never fetch anything the deps stage does not already have.
#
# lint before build: this is where CI gets its linting. The site needs no job of
# its own and no .env; the verb runs in the same image as everything else. The price
# is that a lint error fails the prod build; the verb skips itself when the site
# has no lint script, so only sites that opted into linting are affected.
FROM deps AS build
COPY --from=app --chown=www-data:www-data . .
ENV RIG_VERB_OFFLINE=1
RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN \
    /rig/verbs/install \
 && /rig/verbs/lint \
 && /rig/verbs/build

# prod: slim standalone runner, no nginx front. Requires
# `output: 'standalone'` in the site's next.config. Env-agnostic (12-factor):
# all config is injected at runtime (Cloud Run service YAML / the client's pipeline).
FROM node:${NODE_VERSION}-bookworm-slim AS prod
COPY --from=base /usr/bin/tini /usr/bin/tini
WORKDIR /service/www
ENV NODE_ENV=production
COPY --from=build --chown=www-data:www-data /service/www/.next/standalone ./
COPY --from=build --chown=www-data:www-data /service/www/.next/static ./.next/static
COPY --from=build --chown=www-data:www-data /service/www/public ./public
USER www-data
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
EXPOSE 8080
CMD ["tini", "--", "node", "server.js"]

## LAST: the default target for builds without --target = the dev image (unchanged
## behavior for the sites' compose, which only has the config context).
FROM base AS dev
