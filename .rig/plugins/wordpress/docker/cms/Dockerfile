# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv
# (the skip: NPM_TOKEN=""/COMPOSER_AUTH="{}" are intentionally empty defaults.
# Real tokens come as BuildKit secrets and never end up in a layer.)
# Stages:
#   base      the dev image (nginx + php-fpm + wp-cli + node/pnpm), what compose builds
#   deps      vendor/ + composer cache + pnpm store filled from the lockfiles alone
#   dev-warm  base + warm caches → GHCR (fast bootstrap for dev/agents)
#   build     full source code + the image's verbs: /rig/verbs/install (offline), lint, build
#   prod      fpm+nginx with baked vendor + built theme → Cloud Run / the client's registry
#   dev       alias for base, LAST in the file: builds without --target (the sites'
#             compose) get the dev image and never touch the app context
#
# deps/build/prod are built by plugin ci (rig ci-build) and require a named build
# context with the app's source code (--build-context app=./cms). The theme is found via
# glob: exactly ONE theme directory with package.json is expected under web/app/themes/
# (the rule lives in rig/lib/wp-theme.sh, which the verbs share).
#
# One Dockerfile for headless and classic WordPress. The theme is always built with
# pnpm: the yarn support (the build arg WP_PACKAGE_MANAGER) was removed when no site
# in the fleet used it. It was also the only place in the rig where a build arg
# chose a STAGE instead of a value, so an argument that does not reach CI (only
# EXTRA_* does) broke the build instead of giving the wrong version.
# One build arg differs:
#   DEBIAN_VERSION=bookworm        bullseye for sites pinned to PHP 7.4/8.0
#                                  (php:7.4-fpm-bookworm does not exist); www-data
#                                  is uid 33 on both
#
# RIG_BASE_IMAGE: CI points it at the prebuilt rig base image (published
# by aventyret-rig, tagged with the content hash of the runtime directory, see
# scripts/rig-base-image.sh) so the base-build stage (PHP extensions etc., the
# most expensive part of the build) is never built per site. Without the build arg
# (local dev via compose) FROM resolves the stage name and base-build is built as usual.
ARG RIG_BASE_IMAGE=base-build
ARG PHP_VERSION=8.4.27
ARG COMPOSER_VERSION=2.10.1
ARG WPCLI_VERSION=8.1
# Debian bookworm base — same OS family and Node version as the akka www image so:
#  - the theme build's native modules (esbuild/sharp) use the same glibc
#    prebuilt binaries instead of musl builds/compiles (the reason the www image is
#    Debian), and
#  - www-data has the same uid (33) in both images, letting www and cms share
#    the rig-pnpm-store volume without ownership conflicts.
ARG NODE_VERSION=22.23.4
# pnpm 11 requires Node >= 22.13 — bump together with NODE_VERSION.
ARG PNPM_VERSION=11.10.0
ARG DEBIAN_VERSION=bookworm

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim AS node
FROM composer:${COMPOSER_VERSION} AS composer
FROM wordpress:cli-php${WPCLI_VERSION} AS wordpress
FROM php:${PHP_VERSION}-fpm-${DEBIAN_VERSION} AS base-build

# imagick from a pinned, checksummed source tarball instead of `pecl install`.
# pecl.php.net's REST API is a single point of failure for the whole image: when
# it answered 504 through 2026-10-21 every build died with "Package imagick
# does not have REST info xml available", and that was the day PHP shipped a
# critical security release we needed to rebuild on. The tarball comes from the
# extension's own GitHub repo and the checksum is verified before it is unpacked,
# so the build no longer depends on a registry being up.
# Bump together: the version and the sha256 of
# https://github.com/Imagick/imagick/archive/refs/tags/<version>.tar.gz.
ARG IMAGICK_VERSION=3.8.1
ARG IMAGICK_SHA256=b0e9279ddf6e75a8c6b4068e16daec0475427dbca7ce2e144e30a51a88aa5ddc

COPY --from=wordpress /usr/local/bin/wp /usr/local/bin/wp
COPY --from=composer /usr/bin/composer /usr/bin/composer
# Node + npm/npx/corepack. Same glibc base as this image, so the binaries and
# their symlinks into /usr/local/lib/node_modules just work — no ldconfig
# gymnastics like the old alpine→alpine copy needed.
COPY --from=node /usr/local/bin/ /usr/local/bin/
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules

ENV DEBIAN_FRONTEND=noninteractive

# Bullseye is EOL (LTS through 2026-08-31): the packages live on archive.debian.org
# and deb.debian.org has emptied the bullseye-security pool while the index lives on,
# so apt picks +deb11uN versions that 404. Point main at the archive (expired
# Release files ⇒ Check-Valid-Until off) and drop the security line until
# bullseye-security exists on the archive (check archive.debian.org/debian-security/
# dists/; bullseye was missing there 2026-09-28, only buster and stretch existed).
#
# The price: the archive's main is the last point release (11.11, August 2024). All
# LTS fixes after that until EOL went only via bullseye-security, so the
# dev image loses roughly two years of security fixes, not a few weeks. That
# is the argument for moving the sites pinned to PHP 7.4/8.0 to bookworm.
# Bookworm builds are untouched.
#
# The grep asserts that the sed matched: if a future php image switches to
# deb822 (/etc/apt/sources.list.d/debian.sources) the pattern matches nothing,
# and without the assert the error becomes the same cryptic 404s as above instead of
# a build that stops here.
ARG DEBIAN_VERSION
RUN set -eux; \
    if [ "$DEBIAN_VERSION" = bullseye ]; then \
        sed -i -e 's|http://deb.debian.org/debian |http://archive.debian.org/debian |' \
               -e '/debian-security/d' /etc/apt/sources.list; \
        grep -q 'archive.debian.org' /etc/apt/sources.list; \
        echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99-eol-archive; \
    fi

# PHP extensions + runtime tooling.
#  - libcap2-bin gives us setcap so nginx can bind 443 as non-root (WordPress
#    makes loopback calls to its own https://cms.<site>.test).
#  - ghostscript is what actually rasterizes a PDF page: ImageMagick has no PDF
#    renderer of its own and delegates to `gs`. WordPress needs it to turn page
#    1 of a PDF upload into the attachment thumbnail.
#  - The extension set covers everything WordPress' Site Health checks for
#    (WP_Site_Health::get_test_php_extensions) — exif and intl were the two
#    missing ones.
# The two apt-get installs are deliberately separate: only the first holds
# packages that must survive, and the mark set is captured between them.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        nginx git curl bash gettext-base default-mysql-client tini zip unzip \
        libcap2-bin libgomp1 ghostscript; \
    savedAptMark="$(apt-mark showmanual)"; \
    apt-get install -y --no-install-recommends \
        $PHPIZE_DEPS \
        libpng-dev libjpeg62-turbo-dev libzip-dev libmagickwand-dev \
        libfreetype6-dev libwebp-dev libavif-dev libicu-dev; \
    # gd only learned --with-avif in PHP 8.1; passing it on a 7.4/8.0 pin fails
    # the configure step, so the flag is added per PHP version.
    gdflags="--with-jpeg --with-freetype --with-webp"; \
    if php -r 'exit(PHP_VERSION_ID >= 80100 ? 0 : 1);'; then \
        gdflags="$gdflags --with-avif"; \
    fi; \
    docker-php-ext-configure gd $gdflags; \
    docker-php-ext-install -j"$(nproc)" mysqli pdo pdo_mysql zip opcache gd exif intl bcmath; \
    mkdir -p /usr/src/php/ext/imagick; \
    curl -fsSL "https://github.com/Imagick/imagick/archive/refs/tags/${IMAGICK_VERSION}.tar.gz" -o /tmp/imagick.tar.gz; \
    echo "${IMAGICK_SHA256}  /tmp/imagick.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/imagick.tar.gz -C /usr/src/php/ext/imagick --strip-components=1; \
    rm /tmp/imagick.tar.gz; \
    # pecl stamps the version into php_imagick.h when it packages a release; the
    # git tag still carries the placeholder.
    sed -i "s/@PACKAGE_VERSION@/${IMAGICK_VERSION}/" /usr/src/php/ext/imagick/php_imagick.h; \
    docker-php-ext-install -j"$(nproc)" imagick; \
    # What the sed above protects: an unstamped build reports the extension
    # version as "@PACKAGE_VERSION@", which sorts below every real version, so
    # every plugin with a version gate on imagick (WebP and AVIF support are the
    # common ones) silently decides the extension is too old.
    php -r 'exit(version_compare(phpversion("imagick"), "0.0.1", ">=") ? 0 : 1);'; \
    rm -rf /usr/src/php; \
    # Debian's ImageMagick policy denies the PDF/PS/EPS coders outright (the
    # 2018 Ghostscript CVE era). Without this WordPress still believes it can
    # make PDF previews — Imagick::queryFormats('PDF') answers yes, the policy
    # is only checked on read — and every upload fails with "not allowed by the
    # security policy". Drop those denials and nothing else: no URL/HTTP
    # coders, no indirect @-reads and the resource limits all stay. The grep
    # asserts the sed matched, so a policy reshuffle in a future Debian fails
    # the build instead of silently losing PDF support again.
    for pol in /etc/ImageMagick-*/policy.xml; do \
        sed -i -E '/<policy domain="coder" rights="none" pattern="(PDF|PS|PS2|PS3|EPS|AI)"/d' "$pol"; \
        ! grep -qE 'rights="none" pattern="(PDF|EPS)"' "$pol"; \
    done; \
    # Cleanup, the official php image idiom: mark everything auto, restore the
    # runtime set captured above, then re-mark the shared libraries the built
    # extensions actually link against. That lets --auto-remove take the -dev
    # headers and the ~200 MB of gcc-12/cpp-12/binutils/linux-libc-dev that a
    # plain `purge $PHPIZE_DEPS` leaves behind as orphans, without stripping the
    # ImageMagick runtime libs imagick.so needs at load time.
    # PHPIZE_DEPS still has to be named in the purge: the php base image ships
    # it pre-installed and manual-marked (so docker-php-ext-install works out of
    # the box), so restoring savedAptMark would otherwise keep the whole
    # compiler chain.
    apt-mark auto '.*' > /dev/null; \
    apt-mark manual $savedAptMark > /dev/null; \
    find /usr/local/lib/php/extensions -name '*.so' -exec ldd '{}' ';' \
        | awk '/=>/ { so = $(NF-1); if (index(so, "/usr/local/") == 0) { gsub("^/(usr/)?", "", so); print so } }' \
        | sort -u | xargs -r dpkg-query --search | cut -d: -f1 | sort -u \
        | grep -v -- '-dev$' \
        | xargs -r apt-mark manual > /dev/null; \
    # The -dev filter matters: dpkg-query --search matches substrings, so
    # libc.so.6 and libglib-2.0.so.0 also hit libc6-dev and libglib2.0-dev, and
    # marking those manual would drag ~60 MB of headers (plus pkgconf and
    # linux-libc-dev) through the autoremove. No runtime library is packaged
    # under a -dev name, so dropping them from the sweep is safe.
    #
    # ImageMagick's extra coders (svg, exr, wmf, pango, djvu, dot) are dlopened,
    # so the ldd sweep cannot see them, and the package is merely Recommended by
    # libmagickcore — name it explicitly or autoremove drops those formats.
    dpkg-query -W -f '${Package}\n' 'libmagickcore-*-extra' | xargs -r apt-mark manual > /dev/null; \
    # libc6-dev is named explicitly because PHPIZE_DEPS spells it as the virtual
    # `libc-dev`, which apt-get purge does not resolve; it takes libcrypt-dev,
    # libnsl-dev, libtirpc-dev and linux-libc-dev with it.
    apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false \
        $PHPIZE_DEPS libc6-dev; \
    rm -rf /var/lib/apt/lists/* /tmp/pear

# Enable pnpm via Corepack (bundled with the copied Node install).
# - Update Corepack first: the bundled version can have stale npm registry
#   signing keys and fail pnpm download with "Cannot find matching keyid".
# - Only enable pnpm — `corepack enable` (no args) collides with the yarn
#   symlink present in the copied node /usr/local/bin.
# COREPACK_HOME on a fixed path so the pnpm prepared at build time is found at
# runtime regardless of $HOME; COREPACK_DEFAULT_TO_LATEST=0 pins projects
# without a packageManager field to the prepared version instead of resolving
# "latest" over the network.
ARG PNPM_VERSION
ENV COREPACK_HOME=/service/.corepack
ENV COREPACK_DEFAULT_TO_LATEST=0
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g corepack@latest \
    && corepack enable pnpm \
    && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /service/cms

ENV HOME=/service
# Fixed paths so sites can mount the shared rig-* cache volumes here (created by
# the rig's `make up`, see rig README). Same paths/owner (www-data) as the www
# image, so www and cms share rig-pnpm-store.
ENV COMPOSER_CACHE_DIR=/service/.composer-cache
ENV PNPM_HOME=/service/.pnpm
ENV PNPM_CONFIG_STORE_DIR=/service/.pnpm-store
# pnpm puts its metadata cache under $HOME/.cache and npm its own under
# $HOME/.npm (postinstall scripts that shell out). Sites can mount
# rig-npm-cache there.
ENV NPM_CONFIG_CACHE=/service/.npm
# Trust the rig's mkcert CA for PHP/curl/composer/wp-cli and for Node.
ENV NODE_EXTRA_CA_CERTS=/rig/cert/rootCA.pem

# Drop the stock php-fpm pool so our www.conf is the only one.
RUN rm -f /usr/local/etc/php-fpm.d/www.conf.default /usr/local/etc/php-fpm.d/zz-docker.conf

# Dirs that must exist owned by www-data (uid 33): the cache paths so fresh
# named volumes inherit the mountpoint owner, and the nginx/php-fpm runtime
# dirs so both can run non-root. vendor/ likewise, so sites can mount a named
# volume over it.
RUN mkdir -p \
      /etc/nginx/cert /etc/nginx/http.d \
      /run/nginx /run/php-fpm \
      /var/log/nginx /var/lib/nginx/body /var/lib/nginx/proxy /var/lib/nginx/fastcgi /var/lib/nginx/uwsgi /var/lib/nginx/scgi \
      /service/cms/vendor \
      /service/.composer-cache /service/.pnpm-store /service/.pnpm /service/.corepack /service/.npm /service/.cache \
 && chown -R www-data:www-data /service /run/nginx /run/php-fpm /var/log/nginx /var/lib/nginx /etc/nginx/cert /etc/nginx/http.d

# Let nginx bind 443 as non-root on any host. Docker Desktop already allows it
# (ip_unprivileged_port_start=0); the file capability covers native Linux too,
# where cap_add: NET_BIND_SERVICE alone is not enough for a non-root process.
RUN setcap 'cap_net_bind_service=+ep' /usr/sbin/nginx

COPY config/default.conf   /etc/nginx/http.d/default.conf
COPY config/nginx.conf     /etc/nginx/nginx.conf
COPY config/php-cli.ini    /usr/local/etc/php/conf.d/php-cli.ini
COPY config/php.ini        /usr/local/etc/php/conf.d/php.ini
COPY config/www.conf       /usr/local/etc/php-fpm.d/www.conf
COPY --chown=www-data:www-data config/init.sh       /service/init.sh
# $HOME/.npmrc (HOME=/service) is the one location both npm and pnpm read —
# pnpm ignores npm's global /usr/local/etc/npmrc, and pnpm 11 no longer expands
# ${NPM_TOKEN} in project-level .npmrc.
COPY --chown=www-data:www-data config/npmrc         /service/.npmrc

STOPSIGNAL SIGTERM
USER www-data

# Only 8080. The rig's Traefik has no explicit port label on site routers, so
# its docker provider auto-picks the lowest exposed port. EXPOSE 443 would make
# 443 the lowest (the php-fpm base also exposes 9000), and Traefik would speak
# plaintext HTTP to nginx's TLS port -> 504. The in-container 443 TLS listener
# still works without EXPOSE (it's metadata only, not what makes nginx bind).
EXPOSE 8080

ENV PORT=8080
ENV AKKA_FRONTEND_FLUSH_CACHE_ENDPOINT="/api/services/headless-wp/cache/flush"
# tini as PID1 reaps nginx/php-fpm; no ENTRYPOINT wrapper needed (it only
# exec'd the CMD and didn't even guarantee tini on `docker run … <cmd>`).
CMD ["tini", "--", "/service/init.sh"]

# base = base-build locally, or the prebuilt image in CI (same content).
FROM ${RIG_BASE_IMAGE} AS base

# Site deviations without a .rig patch: extra apt packages and pecl extensions as
# build args from the site's compose (the ci plugin passes EXTRA_* args to
# CI builds). Lives in base, not base-build, so the addition is applied
# on top of the prebuilt image in CI too, where base-build is never built. pecl
# takes version pins (redis-6.2.0); the enable name is the part before the dash.
#
# PHP_INI_SCAN_DIR= resets conf.d for this pecl call only. The stage comes
# after COPY config/php.ini, which points openssl.cafile/curl.cainfo at
# /rig/cert/ca-bundle.crt, a path that only exists when the rig-cert volume is
# mounted, i.e. never during docker build. Without the reset all TLS from PHP
# fails here, and pecl reports it as "No releases available for
# package pecl.php.net/<ext>", which looks like a registry problem. Composer
# copes because composer/ca-bundle validates the path and falls back
# to the system CA store; PEAR/pecl has no such fallback.
#
# This is the last pecl call in the image: imagick comes from a pinned tarball
# (see base-build). The extension names here are the site's, so there is no
# version to pin and no checksum to verify — a site that needs the build to
# survive a pecl.php.net outage patches the extension in instead.
ARG EXTRA_APT_PACKAGES=""
ARG EXTRA_PHP_EXTENSIONS=""
# Site-owned volume mountpoints under /service/cms: relative paths, space-
# separated, e.g. "web/app/themes/sage/node_modules". Created www-data-owned
# in the image so that a fresh named volume inherits the owner (Docker copies the owner
# only from the image's filesystem, not from the bind mount on top of it;
# without this the volume is root-owned and pnpm/composer get EACCES as www-data).
# vendor/ and the cache directories are already handled above; these are the site's own.
ARG EXTRA_MOUNTPOINTS=""
USER root
RUN set -eux; \
    if [ -n "$EXTRA_APT_PACKAGES" ]; then \
        apt-get update; \
        apt-get install -y --no-install-recommends $EXTRA_APT_PACKAGES; \
        rm -rf /var/lib/apt/lists/*; \
    fi; \
    if [ -n "$EXTRA_PHP_EXTENSIONS" ]; then \
        apt-get update; \
        apt-get install -y --no-install-recommends $PHPIZE_DEPS; \
        PHP_INI_SCAN_DIR= pecl install $EXTRA_PHP_EXTENSIONS; \
        for ext in $EXTRA_PHP_EXTENSIONS; do docker-php-ext-enable "${ext%%-*}"; done; \
        apt-get purge -y $PHPIZE_DEPS; \
        rm -rf /var/lib/apt/lists/* /tmp/pear; \
    fi; \
    for d in $EXTRA_MOUNTPOINTS; do \
        mkdir -p "/service/cms/$d"; \
        chown -R www-data:www-data "/service/cms/${d%%/*}"; \
    done
USER www-data

# The image contract: the role's verbs as scripts in the image (rig cms install|build|
# format|lint|doctor runs them, docs/decisions/2026-09-02-image-contract.md),
# plus lib/ which the verbs source. Lives in base, not in dev: CI's build stage runs
# the same install and build verbs as the local command (stage 3, CI parity),
# and the base image in CI is prebuilt up to and including base-build, so the verbs
# always follow the runtime directory.
COPY --chown=www-data:www-data rig/ /rig/

##############################################################################
## CI stages (the ci plugin) — require --build-context app=<the app's source dir>.
## The theme is globbed: exactly ONE directory under web/app/themes/ is expected.

# deps: only lockfiles are copied. `pnpm fetch` fills the pnpm store from the
# theme's lockfile, composer install --no-scripts fills vendor/ + the
# composer cache. The layers are invalidated only when the lockfiles change. Auth comes
# as BuildKit secrets (never in an image layer); defaults so public sites
# build without tokens despite ${NPM_TOKEN} in .npmrc.
#
# Layer order: the theme layers BEFORE the composer layers. A Dockerfile layer
# is invalidated by everything above it, and composer.lock changes far more often
# than the theme's pnpm-lock.yaml (wpackagist plugins versus a handful of devDeps).
# Low change frequency
# on top ⇒ a composer bump avoids rerunning `pnpm fetch`, which is otherwise a
# needless network call to a private registry.
FROM base AS deps
ENV NPM_TOKEN=""
ENV COMPOSER_AUTH="{}"
COPY --from=app --chown=www-data:www-data \
    web/app/themes/*/package.json \
    web/app/themes/*/pnpm-lock.yaml \
    /service/.theme-deps/
RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN \
    cd /service/.theme-deps && pnpm fetch
COPY --from=app --chown=www-data:www-data composer.json composer.lock ./
# The site's auth.json (e.g. the ACF Pro license) is taken from the app context via
# bind mount and removed in the same RUN, so it never ends up in a layer. Optional:
# if the app has no auth.json nothing happens.
#
# Path repositories (vendored packages, e.g. "url": "packages/akka-headless-wp")
# are source code, not lockfiles, but composer install cannot resolve them without
# the directory. They are copied from the same bind mount; the build stage overwrites them
# with COPY . . anyway. Only relative paths within the app, glob allowed.
RUN --mount=type=secret,id=composer_auth,env=COMPOSER_AUTH \
    --mount=type=bind,from=app,target=/service/.app-src \
    if [ -f /service/.app-src/auth.json ]; then cp /service/.app-src/auth.json auth.json; fi \
 && for p in $(php -r 'foreach (json_decode(file_get_contents("composer.json"), true)["repositories"] ?? [] as $r) { if (($r["type"] ?? "") === "path" && !preg_match("#^(/|\\.\\./)#", $r["url"])) echo $r["url"], "\n"; }'); do \
      for d in /service/.app-src/$p; do \
        [ -d "$d" ] || continue; \
        rel="${d#/service/.app-src/}"; \
        mkdir -p "$(dirname "$rel")" && cp -R "$d" "$rel"; \
      done; \
    done \
 && composer install --no-scripts --no-autoloader --no-interaction --no-progress \
 && rm -f auth.json

# dev-warm: today's dev image with warm caches at the default paths.
# Named volumes are seeded by Docker from the image's content when the volume is empty,
# so a fresh agent environment gets warm caches for free; existing volumes are untouched.
FROM base AS dev-warm
COPY --from=deps --chown=www-data:www-data /service/.composer-cache /service/.composer-cache
COPY --from=deps --chown=www-data:www-data /service/.pnpm-store /service/.pnpm-store
COPY --from=deps --chown=www-data:www-data /service/.cache /service/.cache

# build: full source code, then the image's own verbs, the same scripts that `rig cms
# install` and `rig cms build` run locally (stage 3, CI parity). The install verb
# runs composer with scripts + autoload (vendor from deps ⇒ no new
# downloads), the theme's composer and pnpm. RIG_VERB_OFFLINE=1 makes it
# resolve only against the store/cache from deps with a frozen lockfile (pnpm install
# --offline --frozen-lockfile). The theme glob (exactly one theme with package.json)
# lives in /rig/lib/wp-theme.sh, the same rule locally and here. dump-autoload --optimize is
# packaging for prod and stays in the Dockerfile.
FROM deps AS build
COPY --from=app --chown=www-data:www-data . .
ENV RIG_VERB_OFFLINE=1
# lint before build: this is where CI gets its linting of the theme. The site needs
# no job of its own and no .env. The verb skips itself when the theme
# has no lint script, which most do not today.
RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN \
    --mount=type=secret,id=composer_auth,env=COMPOSER_AUTH \
    /rig/verbs/install \
 && composer dump-autoload --optimize \
 && /rig/verbs/lint \
 && /rig/verbs/build

# prod: the same runtime as dev (nginx + php-fpm + init.sh) with baked vendor and
# built theme. Env-agnostic (12-factor): WP_HOME/WP_SITEURL/DB/Redis etc. are
# injected at runtime (Cloud Run service YAML / the client's pipeline).
FROM base AS prod
COPY --from=build --chown=www-data:www-data /service/cms /service/cms

## LAST: the default target for builds without --target = the dev image (unchanged
## behavior for the sites' compose, which only has the config context).
FROM base AS dev
