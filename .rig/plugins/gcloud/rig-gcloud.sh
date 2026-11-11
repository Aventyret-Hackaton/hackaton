#!/usr/bin/env bash
set -euo pipefail

# rig-gcloud.sh — provisioning of the shared GCP dev project and onboarding
# of sites (docs/decisions/2026-08-01-ci-cd-plan.md 1.3). Idempotent: everything is describe-or-create,
# safe to rerun. Five modes:
#
#   rig-gcloud.sh project-init   Once per GCP project (run from any dir
#                                by an admin): APIs, Artifact Registry, WIF
#                                pool/provider, deploy SA, VPC peering,
#                                Cloud SQL (MySQL) + Memorystore (Redis).
#
#   rig-gcloud.sh site-init      Once per site repo (run from the site repo's
#                                root, via `rig gcloud setup`): WIF binding
#                                for the repo, database + user + password
#                                secret, initial Cloud Run services, GitHub
#                                Actions variables via gh.
#
#   rig-gcloud.sh apply          Apply deploy/<service>.dev.yaml
#                                (the infra skeleton) with the service's current
#                                image. Run via `rig gcloud-apply`, which
#                                runs env-sync right after. replace
#                                resets the env variables.
#
#   rig-gcloud.sh env-sync       Sync env + secrets from <service>/.env.template
#                                to the Cloud Run service: op:// references become
#                                Secret Manager secrets, rig:// references are
#                                resolved against the dev environment (service URLs,
#                                Cloud SQL, Memorystore), rig-secret:// is bound
#                                as environment-owned secrets, plain config becomes
#                                literal env. Run via `rig gcloud-env`.
#
#   rig-gcloud.sh revision-env   Print the revision's URL env (KEY=URL||...) for
#                                CI deploys: RIG_SERVICE_URL + the template's
#                                rig://<service>/url[-internal] and
#                                env/cookie-domain keys, resolved against
#                                the service's canonical URL. Run via
#                                `rig gcloud-revision-env` (CI).
#
# Configuration via environment variables (defaults for Äventyret's setup):
#   GCP_PROJECT   (default aventyret-rig, the shared dev project)
#                                       GCP_REGION    (default europe-north1)
#   GITHUB_ORG    (default Aventyret)   AR_REPO       (default sites)
#   WIF_POOL      (default github)      WIF_PROVIDER  (default github-oidc)
#   DEPLOY_SA     (default rig-deployer)
#   SQL_INSTANCE  (default rig-dev-mysql)
#   REDIS_INSTANCE (default rig-dev-redis)
#   NETWORK       (default default)
#
# Auth GitHub→GCP goes via Workload Identity Federation. No SA keys.

GCP_PROJECT="${GCP_PROJECT:-aventyret-rig}"
GCP_REGION="${GCP_REGION:-europe-north1}"
GITHUB_ORG="${GITHUB_ORG:-Aventyret}"
AR_REPO="${AR_REPO:-sites}"
WIF_POOL="${WIF_POOL:-github}"
WIF_PROVIDER="${WIF_PROVIDER:-github-oidc}"
DEPLOY_SA="${DEPLOY_SA:-rig-deployer}"
SQL_INSTANCE="${SQL_INSTANCE:-rig-dev-mysql}"
REDIS_INSTANCE="${REDIS_INSTANCE:-rig-dev-redis}"
NETWORK="${NETWORK:-default}"

log() { echo "⚙️  rig-gcloud: $*"; }
die() { echo "❌ $*" >&2; exit 1; }

command -v gcloud >/dev/null || die "gcloud is missing — https://cloud.google.com/sdk/docs/install"
[ -n "$GCP_PROJECT" ] || die "set GCP_PROJECT (the shared dev project)"

SA_EMAIL="$DEPLOY_SA@$GCP_PROJECT.iam.gserviceaccount.com"

# PROJECT_NUMBER (WIF paths, runtime SA) is needed only by project-init and
# site-init. It requires the Cloud Resource Manager API, which the CI identity
# (rig-deployer via WIF) neither has nor should have. Lazy so the CI modes
# (env-sync, revision-env, apply) never touch it.
PROJECT_NUMBER=""
WIF_POOL_PATH=""
WIF_PROVIDER_PATH=""
RUNTIME_SA=""
require_project_number() {
  [ -n "$PROJECT_NUMBER" ] && return 0
  PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT" --format='value(projectNumber)')" \
    || die "cannot read the project $GCP_PROJECT — check gcloud auth + project name"
  WIF_POOL_PATH="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$WIF_POOL"
  WIF_PROVIDER_PATH="$WIF_POOL_PATH/providers/$WIF_PROVIDER"
  RUNTIME_SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
}

##############################################################################
## project-init

cmd_project_init() {
  require_project_number
  log "project-init against $GCP_PROJECT ($GCP_REGION)"

  log "enabling APIs..."
  gcloud services enable --project="$GCP_PROJECT" \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    iam.googleapis.com \
    iamcredentials.googleapis.com \
    sqladmin.googleapis.com \
    secretmanager.googleapis.com \
    servicenetworking.googleapis.com \
    redis.googleapis.com \
    compute.googleapis.com

  if ! gcloud artifacts repositories describe "$AR_REPO" \
      --project="$GCP_PROJECT" --location="$GCP_REGION" >/dev/null 2>&1; then
    gcloud artifacts repositories create "$AR_REPO" \
      --project="$GCP_PROJECT" --location="$GCP_REGION" \
      --repository-format=docker \
      --description="Rig: prod images for the sites' dev/PR deploys"
    log "✅ Artifact Registry repo: $AR_REPO"
  else
    log "Artifact Registry repo $AR_REPO exists"
  fi

  if ! gcloud iam workload-identity-pools describe "$WIF_POOL" \
      --project="$GCP_PROJECT" --location=global >/dev/null 2>&1; then
    gcloud iam workload-identity-pools create "$WIF_POOL" \
      --project="$GCP_PROJECT" --location=global \
      --display-name="GitHub Actions"
    log "✅ WIF pool: $WIF_POOL"
  else
    log "WIF pool $WIF_POOL exists"
  fi

  # The attribute condition locks the pool to the GitHub org; per-repo access
  # is set in site-init (principalSet per attribute.repository).
  if ! gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" \
      --project="$GCP_PROJECT" --location=global \
      --workload-identity-pool="$WIF_POOL" >/dev/null 2>&1; then
    gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
      --project="$GCP_PROJECT" --location=global \
      --workload-identity-pool="$WIF_POOL" \
      --display-name="GitHub OIDC" \
      --issuer-uri="https://token.actions.githubusercontent.com" \
      --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
      --attribute-condition="assertion.repository_owner == '$GITHUB_ORG'"
    log "✅ WIF provider: $WIF_PROVIDER (locked to org $GITHUB_ORG)"
  else
    log "WIF provider $WIF_PROVIDER exists"
  fi

  if ! gcloud iam service-accounts describe "$SA_EMAIL" \
      --project="$GCP_PROJECT" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$DEPLOY_SA" \
      --project="$GCP_PROJECT" --display-name="Rig deployer (GitHub Actions)"
    log "✅ service account: $SA_EMAIL"
  else
    log "service account $SA_EMAIL exists"
  fi

  local role
  for role in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
    gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
      --member="serviceAccount:$SA_EMAIL" --role="$role" \
      --condition=None --quiet >/dev/null
  done
  log "✅ deploy SA roles (run.admin, artifactregistry.writer, iam.serviceAccountUser)"

  # The runtime SA (default compute) reads secrets and reaches Cloud SQL.
  for role in roles/secretmanager.secretAccessor roles/cloudsql.client; do
    gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
      --member="serviceAccount:$RUNTIME_SA" --role="$role" \
      --condition=None --quiet >/dev/null
  done
  log "✅ runtime SA roles (secretAccessor, cloudsql.client)"

  # Private IP for Cloud SQL/Memorystore: allocated range + service peering on
  # the VPC. Cloud Run reaches them via Direct VPC egress (set in the service YAML).
  if ! gcloud compute addresses describe google-managed-services-"$NETWORK" \
      --project="$GCP_PROJECT" --global >/dev/null 2>&1; then
    gcloud compute addresses create google-managed-services-"$NETWORK" \
      --project="$GCP_PROJECT" --global --purpose=VPC_PEERING \
      --prefix-length=16 --network="$NETWORK"
    log "✅ peering range: google-managed-services-$NETWORK"
  else
    log "peering range exists"
  fi
  gcloud services vpc-peerings connect \
    --project="$GCP_PROJECT" \
    --service=servicenetworking.googleapis.com \
    --ranges=google-managed-services-"$NETWORK" \
    --network="$NETWORK" >/dev/null 2>&1 \
    || log "vpc peering exists (or was not updated — check on errors)"

  if ! gcloud sql instances describe "$SQL_INSTANCE" \
      --project="$GCP_PROJECT" >/dev/null 2>&1; then
    log "creating the Cloud SQL instance $SQL_INSTANCE (takes several minutes)..."
    gcloud sql instances create "$SQL_INSTANCE" \
      --project="$GCP_PROJECT" --region="$GCP_REGION" \
      --database-version=MYSQL_8_0 --tier=db-g1-small \
      --network="projects/$GCP_PROJECT/global/networks/$NETWORK" \
      --no-assign-ip
    log "✅ Cloud SQL: $SQL_INSTANCE"
  else
    log "the Cloud SQL instance $SQL_INSTANCE exists"
  fi

  if ! gcloud redis instances describe "$REDIS_INSTANCE" \
      --project="$GCP_PROJECT" --region="$GCP_REGION" >/dev/null 2>&1; then
    log "creating the Memorystore instance $REDIS_INSTANCE (takes several minutes)..."
    gcloud redis instances create "$REDIS_INSTANCE" \
      --project="$GCP_PROJECT" --region="$GCP_REGION" \
      --size=1 --redis-version=redis_7_0 \
      --network="projects/$GCP_PROJECT/global/networks/$NETWORK"
    log "✅ Memorystore: $REDIS_INSTANCE"
  else
    log "the Memorystore instance $REDIS_INSTANCE exists"
  fi

  log "✅ project-init done. Next: 'rig gcloud setup' in each site repo."
}

##############################################################################
## site-init

cmd_site_init() {
  require_project_number
  command -v gh >/dev/null || die "gh is missing — brew install gh && gh auth login"
  local repo site services
  repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" \
    || die "no GitHub remote here — run from the site repo's root"
  site="${RIG_SITE:-$(basename "$PWD")}"
  # Cloud SQL/Secret Manager/Cloud Run require [a-z0-9-]. Directory names like
  # "vi.se" or "Arenagruppen" do not work as a fallback.
  [[ "$site" =~ ^[a-z][a-z0-9-]*$ ]] \
    || die "invalid site name '$site' (allowed: lowercase, digits, hyphens) — set RIG_SITE in the site's rigfile"
  # Fallback via the runner (which reads RIG_DEPLOY_SERVICES from rigfile). The
  # script is called both from the ci plugin and standalone from workflows.
  services="${RIG_DEPLOY_SERVICES:-$( [ -x .rig/bin/rig ] && .rig/bin/rig ci-services 2>/dev/null || true )}"
  [ -n "$services" ] || die "no services — set RIG_DEPLOY_SERVICES in the site's rigfile (e.g. 'www cms')"
  log "site-init: $repo → site '$site', services: $services"

  # 1. WIF: let the repo's GitHub Actions act as the deploy SA.
  gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
    --project="$GCP_PROJECT" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/$WIF_POOL_PATH/attribute.repository/$repo" \
    --quiet >/dev/null
  log "✅ WIF binding for $repo"

  # 2. Database + user + password secret (cms/wp sites; harmless otherwise).
  if ! gcloud sql databases describe "$site" \
      --instance="$SQL_INSTANCE" --project="$GCP_PROJECT" >/dev/null 2>&1; then
    gcloud sql databases create "$site" \
      --instance="$SQL_INSTANCE" --project="$GCP_PROJECT"
    log "✅ database: $site"
  else
    log "the database $site exists"
  fi
  if ! gcloud secrets describe "$site-db-password" \
      --project="$GCP_PROJECT" >/dev/null 2>&1; then
    local pass
    pass="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
    gcloud sql users create "$site" \
      --instance="$SQL_INSTANCE" --project="$GCP_PROJECT" --password="$pass"
    printf '%s' "$pass" | gcloud secrets create "$site-db-password" \
      --project="$GCP_PROJECT" --data-file=-
    log "✅ db user $site + secret $site-db-password"
  else
    log "the secret $site-db-password exists (the db user is assumed created)"
  fi

  # 3. Initial Cloud Run services so the URLs exist. Real deploys happen
  #    declaratively in CI (gcloud run services replace deploy/<service>.dev.yaml).
  local svc
  for svc in $services; do
    if ! gcloud run services describe "$site-$svc" \
        --project="$GCP_PROJECT" --region="$GCP_REGION" >/dev/null 2>&1; then
      gcloud run deploy "$site-$svc" \
        --project="$GCP_PROJECT" --region="$GCP_REGION" \
        --image=us-docker.pkg.dev/cloudrun/container/hello \
        --allow-unauthenticated --quiet
      log "✅ Cloud Run service: $site-$svc"
    else
      log "the Cloud Run service $site-$svc exists"
    fi
  done

  # 4. GitHub Actions variables. The only thing workflows need to know about GCP.
  gh variable set RIG_SITE --body "$site"
  gh variable set GCP_PROJECT --body "$GCP_PROJECT"
  gh variable set GCP_REGION --body "$GCP_REGION"
  gh variable set GCP_AR_REPO --body "$AR_REPO"
  gh variable set GCP_WIF_PROVIDER --body "$WIF_PROVIDER_PATH"
  gh variable set GCP_DEPLOY_SA --body "$SA_EMAIL"
  log "✅ GitHub Actions variables set (RIG_SITE, GCP_*)"

  # No "next steps" list here: 'rig gcloud setup' continues directly with
  # gcloud-apply (infra + env). The same applies when the script runs
  # standalone: apply is the next verb, and its error messages point the right way.
  log "✅ site-init done"
}

##############################################################################
## apply — deploy/<service>.dev.yaml → gcloud run services replace

# The infra skeleton (scaling, VPC, resources) is owned by the YAML file and
# applied from here. Never by CI, which only swaps the image (gcloud run deploy --image).
# replace is authoritative for the whole spec, so the env variables disappear:
# rig gcloud-apply therefore always runs env-sync right after.

cmd_apply() {
  local service="${1:-}"
  [ -n "$service" ] || die "usage: rig-gcloud.sh apply <service>"
  local site="${RIG_SITE:-$(basename "$PWD")}"
  [[ "$site" =~ ^[a-z][a-z0-9-]*$ ]] \
    || die "invalid site name '$site' (allowed: lowercase, digits, hyphens) — set RIG_SITE in the site's rigfile"
  local yaml="deploy/$service.dev.yaml"
  [ -f "$yaml" ] || die "$yaml is missing — scaffold it with 'rig self update' (requires gcloud in RIG_MODULES)"

  # The current image is kept. The YAML describes infra, CI owns the image.
  local svc_name="$site-$service" image tmp
  image="$(gcloud run services describe "$svc_name" \
    --project="$GCP_PROJECT" --region="$GCP_REGION" \
    --format='value(spec.template.spec.containers[0].image)' 2>/dev/null || true)"
  [ -n "$image" ] || image="us-docker.pkg.dev/cloudrun/container/hello"

  tmp="$(mktemp)"
  sed "s|__IMAGE__|$image|" "$yaml" > "$tmp"
  gcloud run services replace "$tmp" \
    --project="$GCP_PROJECT" --region="$GCP_REGION" >/dev/null
  rm -f "$tmp"
  log "✅ $svc_name: infra skeleton applied ($yaml, image: $image)"
}

##############################################################################
## env-sync — <service>/.env.template → Secret Manager + Cloud Run env

# The same templates that drive `rig env` locally. The templates are the whole
# contract. The root .env.template is layered under the service's (shared keys,
# the service wins on conflict), the same layering as compose env_file locally.
# Classification per line from the value's scheme (never the key name):
#   rig://<service>/<facet>      environment fact, resolved against the dev environment (see
#                                the facets below); locally rig-env.sh resolves
#                                the same reference against the site's .env.rig
#   rig-secret://<service>/<facet> environment-owned secret, bound as secretKeyRef to
#                                <site>-<service>-<facet> (db/password is created
#                                by site-init); the value is never handled by
#                                humans and never leaves Secret Manager
#   op:// reference              → Secret Manager secret <site>-<key>
#                                (created/new version only when the value changed)
#                                + secretKeyRef on the service
#   plain value                  → literal env on the service
#   ENV_SYNC_SKIP                → never set in the cloud (see below)
# The sync is additive (--update-*): keys removed from the template are not
# removed automatically. Clean up with gcloud run services update --remove-env-vars.
#
# rig:// facets in the dev environment:
#   db/host           the Cloud SQL instance's private IP     db/port  3306
#   db/name, db/user  the site name
#   redis/host|port   Memorystore via describe
#   redis/url         redis://<host>:<port> (built from the same describe)
#   env/name          staging
#   env/cookie-domain the service's own host (run.app is a public suffix, no
#                     shared cookie domain exists; locally: the parent .test domain)
#   <svc>/url         the sibling service's run.app URL. url-internal gives the same
#                     answer (public and internal path are the same URL on Cloud Run;
#                     locally they differ: ingress URL and compose URL respectively)

# WP_HOME/WP_SITEURL are derived from the request's Host header in the site's PHP config
# (works for dev, PR tags and custom domains; never set as env).
# NPM_TOKEN/COMPOSER_AUTH are build time, not runtime. COMMIT_HASH is runtime but
# bound to the revision: it is set per deploy by revision-env, not from here. A
# template line would have given all revisions the same value. NETWORK is compose infra
# (the rig network) and has no meaning in the cloud.
ENV_SYNC_SKIP="WP_HOME WP_SITEURL NPM_TOKEN COMPOSER_AUTH COMMIT_HASH NETWORK"

# Secret facets (guardrail): may only be referenced with rig-secret://. A
# rig:// reference to them fails hard so a secret never becomes literal env.
# Keep in sync with RIG_SECRET_FACETS in rig-env.sh.
RIG_SECRET_FACETS="password"
is_secret_facet() {
  case " $RIG_SECRET_FACETS " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

sync_secret() { # <name> <value> — create, or a new version only on change
  local name="$1" value="$2" current
  if ! gcloud secrets describe "$name" --project="$GCP_PROJECT" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets create "$name" \
      --project="$GCP_PROJECT" --data-file=- >/dev/null
    log "  ✅ secret $name created"
  else
    current="$(gcloud secrets versions access latest --secret="$name" \
      --project="$GCP_PROJECT" 2>/dev/null || true)"
    if [ "$current" = "$value" ]; then
      log "  secret $name unchanged"
    else
      printf '%s' "$value" | gcloud secrets versions add "$name" \
        --project="$GCP_PROJECT" --data-file=- >/dev/null
      log "  ✅ secret $name: new version"
    fi
  fi
}

strip_quotes() { # .env values may be quoted; Cloud Run wants the raw value
  local v="$1"
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
  esac
  printf '%s' "$v"
}

# Memoized dev environment facts: one describe per instance/service regardless of how
# many keys reference it. RIG_URL_MAP: "service=url ..." (seeded with
# the service itself in cmd_env_sync).
RIG_DB_HOST=""
RIG_REDIS_HOST=""
RIG_REDIS_PORT=""
RIG_URL_MAP=""

resolve_rig_fact() { # <service> <facet> — sets RIG_FACT ($site/$key from the caller)
  local rsvc="$1" rfacet="$2" map murl
  RIG_FACT=""
  case "$rsvc/$rfacet" in
    db/host)
      if [ -z "$RIG_DB_HOST" ]; then
        RIG_DB_HOST="$(gcloud sql instances describe "$SQL_INSTANCE" \
          --project="$GCP_PROJECT" \
          --format='value(ipAddresses.filter("type:PRIVATE").extract(ipAddress).flatten())')"
        [ -n "$RIG_DB_HOST" ] || die "cannot read the private IP of $SQL_INSTANCE"
      fi
      RIG_FACT="$RIG_DB_HOST" ;;
    db/port) RIG_FACT="3306" ;;
    db/name|db/user) RIG_FACT="$site" ;;
    redis/host|redis/port|redis/url)
      if [ -z "$RIG_REDIS_HOST" ]; then
        RIG_REDIS_HOST="$(gcloud redis instances describe "$REDIS_INSTANCE" \
          --project="$GCP_PROJECT" --region="$GCP_REGION" --format='value(host)')"
        RIG_REDIS_PORT="$(gcloud redis instances describe "$REDIS_INSTANCE" \
          --project="$GCP_PROJECT" --region="$GCP_REGION" --format='value(port)')"
        [ -n "$RIG_REDIS_HOST" ] || die "cannot read the host of $REDIS_INSTANCE"
      fi
      case "$rfacet" in
        host) RIG_FACT="$RIG_REDIS_HOST" ;;
        port) RIG_FACT="$RIG_REDIS_PORT" ;;
        url)  RIG_FACT="redis://$RIG_REDIS_HOST:$RIG_REDIS_PORT" ;;
      esac ;;
    env/name) RIG_FACT="staging" ;;
    env/cookie-domain)
      # The domain where the environment's services share cookies. Locally the
      # site's shared *.test parent domain (.env.rig); on Cloud Run there is no
      # shared domain (run.app is on the Public Suffix List, browsers refuse cookies there),
      # so the best possible is the service's own host: a host-only cookie.
      RIG_FACT="${service_url#https://}"
      RIG_FACT="${RIG_FACT%%/*}" ;;
    */url|*/url-internal)
      for map in $RIG_URL_MAP; do
        if [ "${map%%=*}" = "$rsvc" ]; then RIG_FACT="${map#*=}"; break; fi
      done
      if [ -z "$RIG_FACT" ]; then
        murl="$(gcloud run services describe "$site-$rsvc" \
          --project="$GCP_PROJECT" --region="$GCP_REGION" \
          --format='value(status.url)' 2>/dev/null || true)"
        [ -n "$murl" ] || die "$key: cannot read the URL of $site-$rsvc (rig://$rsvc/$rfacet) — run 'rig gcloud setup' first"
        RIG_URL_MAP="$RIG_URL_MAP $rsvc=$murl"
        RIG_FACT="$murl"
      fi ;;
    *) die "$key: unknown rig:// facet '$rsvc/$rfacet' (known: db/host|port|name|user, redis/host|port|url, env/name|cookie-domain, <service>/url[-internal])" ;;
  esac
}

cmd_env_sync() {
  local service="${1:-}" template="${2:-}"
  [ -n "$service" ] && [ -n "$template" ] \
    || die "usage: rig-gcloud.sh env-sync <service> <template>"
  local site="${RIG_SITE:-$(basename "$PWD")}"
  [[ "$site" =~ ^[a-z][a-z0-9-]*$ ]] \
    || die "invalid site name '$site' (allowed: lowercase, digits, hyphens) — set RIG_SITE in the site's rigfile"
  if [ ! -f "$template" ]; then
    log "$service: $template is missing — skipping"
    return 0
  fi

  # The service's canonical URL is injected as RIG_SERVICE_URL, a neutral
  # platform fact (Cloud Run sets no hostname env itself). The app
  # derives its URLs: the request's Host header first (correct also for
  # custom domains), RIG_SERVICE_URL as fallback for
  # CLI/cron that lack HTTP_HOST.
  local svc_name="$site-$service" service_url
  service_url="$(gcloud run services describe "$svc_name" \
    --project="$GCP_PROJECT" --region="$GCP_REGION" \
    --format='value(status.url)' 2>/dev/null)" \
    || die "the Cloud Run service $svc_name does not exist — run 'rig gcloud setup' first"
  [ -n "$service_url" ] || die "cannot read the URL of $svc_name"

  # Layer like compose env_file: the root .env.template is a shared base for all
  # services (DB_*, shared AKKA_* etc.), the service's template wins on conflict.
  # Exactly the same layering as locally (env_file: .env + <service>/.env).
  # The service first in the list: the first occurrence of a key wins.
  local templates="$template" root_template=".env.template"
  if [ -f "$root_template" ] && [ "$root_template" != "$template" ]; then
    templates="$template $root_template"
  fi

  # op is needed only if the templates actually have op:// references.
  local resolved
  if cat $templates | grep -q 'op://'; then
    command -v op >/dev/null \
      || die "op is missing ($templates has op:// references) — https://developer.1password.com/docs/cli/"
    # The cat pipe is deliberate: op inject refuses to read stdin from a file redirect
    # ("expected data on stdin"); it requires a pipe. The service's template
    # first, so the key lookup in $resolved hits the service's value.
    resolved="$(cat $templates | op inject)" || die "op inject failed for $templates"
  else
    resolved="$(cat $templates)"
  fi

  # Dev environment facts (Cloud SQL, Memorystore, the sibling services' URLs) are fetched
  # lazily + memoized by resolve_rig_fact. Only what the template references.
  RIG_URL_MAP="$service=$service_url"

  log "env-sync: $svc_name ← $templates"
  local rig_ref_re="^[\"']?rig(-secret)?://([a-z][a-z0-9-]*)/([a-z][a-z0-9-]*)[\"']?$"
  local line key raw_value value secret_name secret_pairs="" tpl handled=""
  local ref_secret rsvc rfacet
  local env_pairs="RIG_SERVICE_URL=$service_url"
  for tpl in $templates; do
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    raw_value="${BASH_REMATCH[2]}"
    raw_value="${raw_value%"${raw_value##*[![:space:]]}"}"

    # Already handled by an earlier template in the list (the service wins)?
    case " $handled " in *" $key "*) continue ;; esac
    handled="$handled $key"

    case " $ENV_SYNC_SKIP " in *" $key "*) continue ;; esac

    # rig:// and rig-secret:// references: environment facts and environment-owned
    # secrets respectively, the same references rig-env.sh resolves locally against .env.rig.
    if [[ "$raw_value" =~ $rig_ref_re ]]; then
      ref_secret="${BASH_REMATCH[1]}"
      rsvc="${BASH_REMATCH[2]}"
      rfacet="${BASH_REMATCH[3]}"
      if [ -n "$ref_secret" ]; then
        is_secret_facet "$rfacet" \
          || die "$key: '$rfacet' is not a secret facet (known: $RIG_SECRET_FACETS) — use rig://$rsvc/$rfacet"
        secret_name="$site-$rsvc-$rfacet"
        gcloud secrets describe "$secret_name" --project="$GCP_PROJECT" >/dev/null 2>&1 \
          || die "$key: the secret $secret_name does not exist — db/password is created by 'rig gcloud setup' (site-init), others are created manually in Secret Manager"
        secret_pairs="${secret_pairs:+$secret_pairs,}$key=$secret_name:latest"
        continue
      fi
      if is_secret_facet "$rfacet"; then
        die "$key: '$rfacet' is a secret facet — use rig-secret://$rsvc/$rfacet (otherwise the value becomes literal env)"
      fi
      resolve_rig_fact "$rsvc" "$rfacet"
      env_pairs="${env_pairs:+$env_pairs||}$key=$RIG_FACT"
      continue
    fi

    if [[ "$raw_value" == *op://* ]]; then
      value="$(printf '%s\n' "$resolved" \
        | sed -nE "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" | head -1)"
      value="$(strip_quotes "${value%"${value##*[![:space:]]}"}")"
      [ -n "$value" ] || die "empty value for $key after op inject"
      secret_name="$site-$(printf '%s' "$key" | tr 'A-Z_' 'a-z-')"
      sync_secret "$secret_name" "$value"
      secret_pairs="${secret_pairs:+$secret_pairs,}$key=$secret_name:latest"
    else
      value="$(strip_quotes "$raw_value")"
      env_pairs="${env_pairs:+$env_pairs||}$key=$value"
    fi
  done < "$tpl"
  done

  # ^||^ = a custom delimiter so values with commas survive.
  gcloud run services update "$svc_name" \
    --project="$GCP_PROJECT" --region="$GCP_REGION" \
    "${env_pairs:+--update-env-vars=^||^$env_pairs}" \
    "${secret_pairs:+--update-secrets=$secret_pairs}" \
    --quiet >/dev/null
  log "✅ $svc_name: env synced (new revision created)"
}

##############################################################################
## revision-env — the revision's URL env for CI deploys

# The main deploy rebakes the URL keys with the canonical URLs on every deploy.
# Removed PR previews baked tag URLs into the service template, and a dev
# service whose last deploy was one still carries them.
# Output (stdout, one line): KEY=VALUE||KEY=VALUE... , deployed with
# --update-env-vars=^||^... . The keys are the URL-bearing ones that env-sync classifies
# the same way (RIG_SERVICE_URL, rig://<service>/url|url-internal and
# env/cookie-domain), plus COMMIT_HASH; everything else (db, redis, secrets,
# literals) is revision-invariant and left untouched.

cmd_revision_env() {
  local service="${1:-}" template="${2:-}"
  [ -n "$service" ] && [ -n "$template" ] \
    || die "usage: rig-gcloud.sh revision-env <service> <template>"
  local site="${RIG_SITE:-$(basename "$PWD")}"
  [[ "$site" =~ ^[a-z][a-z0-9-]*$ ]] \
    || die "invalid site name '$site' (allowed: lowercase, digits, hyphens) — set RIG_SITE in the site's rigfile"

  # Canonical URL per service, memoized in RIG_URL_MAP (shared with env-sync).
  base_url() { # <service>
    local rsvc="$1" map murl
    for map in $RIG_URL_MAP; do
      if [ "${map%%=*}" = "$rsvc" ]; then printf '%s' "${map#*=}"; return; fi
    done
    murl="$(gcloud run services describe "$site-$rsvc" \
      --project="$GCP_PROJECT" --region="$GCP_REGION" \
      --format='value(status.url)' 2>/dev/null || true)"
    [ -n "$murl" ] || die "cannot read the URL of $site-$rsvc — run 'rig gcloud setup' first"
    RIG_URL_MAP="$RIG_URL_MAP $rsvc=$murl"
    printf '%s' "$murl"
  }
  local own_url pairs
  own_url="$(base_url "$service")"
  pairs="RIG_SERVICE_URL=$own_url"

  # Which code the revision runs. Apps use it to version caches:
  # without it a new release inherits the previous version's keys and serves
  # content written by code that no longer exists. Same source as `rig env`
  # writes locally, so dev and cloud have the same contract. Always called in a
  # checkout of the commit being deployed (site-main and site-pr); better to drop
  # the value than to fail the deploy on it.
  local commit_hash
  commit_hash="$(git rev-parse --short HEAD 2>/dev/null || true)"
  [ -z "$commit_hash" ] || pairs="$pairs||COMMIT_HASH=$commit_hash"

  # Same template layering as env-sync: the service's template + the root's,
  # the service wins on conflict. Missing template ⇒ only the rig-owned pairs above.
  local templates="" root_template=".env.template"
  [ -f "$template" ] && templates="$template"
  if [ -f "$root_template" ] && [ "$root_template" != "$template" ]; then
    templates="$templates $root_template"
  fi

  local rig_ref_re="^[\"']?rig://([a-z][a-z0-9-]*)/([a-z][a-z0-9-]*)[\"']?$"
  local tpl line key raw_value handled="" rsvc rfacet host
  for tpl in $templates; do
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    raw_value="${BASH_REMATCH[2]}"
    raw_value="${raw_value%"${raw_value##*[![:space:]]}"}"
    case " $handled " in *" $key "*) continue ;; esac
    handled="$handled $key"
    case " $ENV_SYNC_SKIP " in *" $key "*) continue ;; esac
    [[ "$raw_value" =~ $rig_ref_re ]] || continue
    rsvc="${BASH_REMATCH[1]}"
    rfacet="${BASH_REMATCH[2]}"
    case "$rsvc/$rfacet" in
      env/cookie-domain)
        host="${own_url#https://}"
        pairs="$pairs||$key=${host%%/*}" ;;
      # Reserved namespaces (db/redis/env) are revision-invariant environment
      # facts and owned by env-sync. Same precedence as resolve_rig_fact.
      db/*|redis/*|env/*) ;;
      */url|*/url-internal)
        pairs="$pairs||$key=$(base_url "$rsvc")" ;;
    esac
  done < "$tpl"
  done

  printf '%s\n' "$pairs"
}

case "${1:-}" in
  project-init) cmd_project_init ;;
  site-init)    cmd_site_init ;;
  apply)        shift; cmd_apply "$@" ;;
  env-sync)     shift; cmd_env_sync "$@" ;;
  revision-env) shift; cmd_revision_env "$@" ;;
  *) die "usage: rig-gcloud.sh {project-init|site-init|apply|env-sync|revision-env}" ;;
esac
