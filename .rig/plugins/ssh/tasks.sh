# ssh — provider adapter for SSH hosting (Oderland, Cloudnet, ...).
#
# The principle is build once even without containers on the host: the prod image is
# the artifact, the adapter extracts the app directory from it and places it with
# the host's own mechanics (rsync to deployment/<name>/, symlink swap via
# the site's post-deploy script). The same digest that runs in a container environment
# is thereby behind a Passenger/cPanel site. `rig running` answers with
# the same name as the tag.
#
# Target file (deploy/targets/<target>.rig), per-service keys with the service's name
# as suffix:
#
#   RIG_TARGET_PROVIDER=ssh
#   RIG_TARGET_SERVICES=www                            (optional; subset of
#                                                       RIG_DEPLOY_SERVICES that runs here)
#   RIG_TARGET_DEPLOY_KEY_SECRET=DEPLOY_KEY_X          (optional; the repo secret with
#                                                       the target's private key in CI, default DEPLOY_KEY)
#   RIG_TARGET_HOST=46.16.236.24
#   RIG_TARGET_USER=jhemsi19
#   RIG_TARGET_SSH_OPTS=-o IdentitiesOnly=yes ...      (optional)
#   RIG_TARGET_FINGERPRINT=46.16.236.24 ssh-ed25519 ...(optional; known_hosts
#                                                       line, added if missing)
#   RIG_TARGET_PLATFORM=linux/amd64                    (optional, default amd64)
#   RIG_TARGET_ROOT_www=/home/jhemsi19/www-stage.vi.se (the app root on the host)
#   RIG_TARGET_DOMAIN_www=www-stage.vi.se
#   RIG_TARGET_APP_DIR_www=/service/www                (where in the image; default /service/<service>)
#   RIG_TARGET_EXTRAS_www=www/.oderland www/errorpages (repo directories placed alongside)
#   RIG_TARGET_POST_DEPLOY_www=.oderland/post_deploy.sh
#
# The post-deploy convention (vi.se/Oderland): the script lives in the deploy and
# is called as <script> <domain> <approot> <approot>/deployment <name>. A host
# script with a different argument order gets a thin wrapper in the repo.
#
# Authentication: the caller's ssh-agent/keys. The adapter handles no
# secrets. In CI it is the workflow's login step (ssh-agent with DEPLOY_KEY).

RIG_PROVIDERS[${#RIG_PROVIDERS[@]}]=ssh

ssh_auth_kind() { echo ssh-key; }

ssh_target_keys() {
  echo "RIG_TARGET_HOST RIG_TARGET_USER RIG_TARGET_SSH_OPTS RIG_TARGET_FINGERPRINT RIG_TARGET_PLATFORM RIG_TARGET_ROOT_* RIG_TARGET_DOMAIN_* RIG_TARGET_APP_DIR_* RIG_TARGET_EXTRAS_* RIG_TARGET_POST_DEPLOY_*"
}

ssh_dest() {
  [ -n "${RIG_TARGET_HOST-}" ] || die "the target file lacks RIG_TARGET_HOST"
  [ -n "${RIG_TARGET_USER-}" ] || die "the target file lacks RIG_TARGET_USER"
  printf '%s@%s\n' "$RIG_TARGET_USER" "$RIG_TARGET_HOST"
}

# The target file's RIG_TARGET_FINGERPRINT (a known_hosts line) is added if it
# is missing. That way a fresh CI runner works without a prepared known_hosts, and
# the host key is declared in the repo instead of TOFU on the first call.
ssh_known_hosts() {
  [ -n "${RIG_TARGET_FINGERPRINT-}" ] || return 0
  mkdir -p "$HOME/.ssh"
  grep -qxF "$RIG_TARGET_FINGERPRINT" "$HOME/.ssh/known_hosts" 2>/dev/null \
    || printf '%s\n' "$RIG_TARGET_FINGERPRINT" >> "$HOME/.ssh/known_hosts"
}

ssh_remote() {
  # SSH_OPTS is word-split on purpose
  # shellcheck disable=SC2086
  ssh ${RIG_TARGET_SSH_OPTS-} "$(ssh_dest)" "$@"
}

ssh_provider_deploy() {   # <target> <service> <image>
  local target="$1" svc="$2" image="$3"
  local root domain app_dir extras post name tmp cid e platform
  root="$(deploy_svc_var ROOT "$svc")"
  [ -n "$root" ] || die "deploy/targets/$target.rig: RIG_TARGET_ROOT_$svc is missing"
  domain="$(deploy_svc_var DOMAIN "$svc")"
  app_dir="$(deploy_svc_var APP_DIR "$svc")"
  app_dir="${app_dir:-/service/$svc}"
  extras="$(deploy_svc_var EXTRAS "$svc")"
  post="$(deploy_svc_var POST_DEPLOY "$svc")"
  platform="${RIG_TARGET_PLATFORM:-linux/amd64}"
  command -v docker >/dev/null 2>&1 || die "docker is missing — the adapter extracts the artifact from the image"
  command -v rsync >/dev/null 2>&1 || die "rsync is missing"
  ssh_known_hosts

  # The deploy name is the tag (sha-abc1234, 2026.08.3). That is what `rig
  # running` later reads back from the current symlink.
  name="$(printf '%s' "${image##*:}" | tr -c 'a-zA-Z0-9._-' '-')"

  log "pulling $image ($platform)"
  docker pull --platform "$platform" -q "$image" >/dev/null

  tmp="$(mktemp -d -t rig-ssh-deploy.XXXXXX)"
  # mktemp creates the directory 700 and rsync -a copies that mode to
  # deployment/<name>/ on the host. The web server must be able to traverse it
  # (cms-stage went down on Oderland until the directory got 755 by hand).
  chmod 755 "$tmp"
  cid="$(docker create --platform "$platform" "$image")"
  if ! docker cp "$cid:$app_dir/." "$tmp/" >/dev/null; then
    docker rm -f "$cid" >/dev/null
    rm -rf "$tmp"
    die "could not extract $app_dir from $image — is RIG_TARGET_APP_DIR_$svc correct?"
  fi
  docker rm -f "$cid" >/dev/null

  # Host-specific files that do not belong in the image (deploy scripts, error pages)
  # are taken from the repo and placed alongside the artifact.
  for e in $extras; do
    [ -e "$SITE_DIR/$e" ] || { rm -rf "$tmp"; die "RIG_TARGET_EXTRAS_$svc: '$e' does not exist in the repo"; }
    cp -R "$SITE_DIR/$e" "$tmp/"
  done

  log "rsync → $(ssh_dest):$root/deployment/$name/"
  # shellcheck disable=SC2086
  rsync -a -e "ssh ${RIG_TARGET_SSH_OPTS-}" "$tmp/" "$(ssh_dest):$root/deployment/$name/"
  rm -rf "$tmp"

  if [ -n "$post" ]; then
    log "post-deploy: $post"
    ssh_remote "$root/deployment/$name/$post" "$domain" "$root" "$root/deployment" "$name"
  fi
  echo "✅ $target/$svc ← $image (deployment/$name)"
}

ssh_provider_running() {   # <target> <service>
  local root cur
  ssh_known_hosts
  root="$(deploy_svc_var ROOT "$2")"
  if [ -z "$root" ]; then
    printf '  %-20s %-8s %s\n' "$1" "$2" "— (no RIG_TARGET_ROOT_$2)"
    return 0
  fi
  cur="$(ssh_remote "readlink $root/current" 2>/dev/null || true)"
  [ -n "$cur" ] || cur="?"
  printf '  %-20s %-8s %s\n' "$1" "$2" "${cur##*/}"
}
