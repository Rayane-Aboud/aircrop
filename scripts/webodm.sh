#!/usr/bin/env bash
# Local WebODM for Aircrop's Orthomosaic feature (see backend/api/webodm.py).
#
#   scripts/webodm.sh up      clone (first run), start WebODM, provision the
#                             Aircrop service account, write backend/.env
#   scripts/webodm.sh down    stop WebODM (data is kept)
#   scripts/webodm.sh logs    follow WebODM logs
#
# WebODM lives in a sibling checkout (../WebODM, override with WEBODM_DIR) and
# runs its own docker-compose stack; it's never vendored into this repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEBODM_DIR="${WEBODM_DIR:-$ROOT/../WebODM}"
WEBODM_PORT="${WEBODM_PORT:-8010}"
SVC_USER="${WEBODM_USERNAME:-aircrop}"
ENV_FILE="$ROOT/backend/.env"

ensure_checkout() {
  if [ ! -d "$WEBODM_DIR" ]; then
    git clone --depth 1 https://github.com/WebODM/WebODM "$WEBODM_DIR"
  fi
}

# Reuse the password already in backend/.env so re-running is idempotent.
service_password() {
  local existing=""
  [ -f "$ENV_FILE" ] && existing="$(sed -n 's/^WEBODM_PASSWORD=//p' "$ENV_FILE")"
  echo "${existing:-$(head -c 18 /dev/urandom | base64 | tr -d '/+=')}"
}

wait_for_webodm() {
  echo "Waiting for WebODM on :$WEBODM_PORT (first boot runs migrations)…"
  for _ in $(seq 1 120); do
    curl -fsS -o /dev/null "http://localhost:$WEBODM_PORT/api/" && return 0
    sleep 5
  done
  echo "WebODM did not come up; check: $0 logs" >&2
  exit 1
}

provision_user() {
  local password="$1"
  # Create/update a regular (non-admin) user that owns all Aircrop projects.
  # Non-admins can only process on nodes their group may view. WebODM grants
  # that to its "Default" group once at first boot — often before the node has
  # registered — so (re)grant it here, and put the user in that group.
  docker exec -i webapp python manage.py shell <<PY
from django.contrib.auth.models import Group, User
from guardian.shortcuts import assign_perm
from nodeodm.models import ProcessingNode
u, _ = User.objects.get_or_create(username='$SVC_USER')
u.set_password('$password')
u.is_active = True
u.save()
group, _ = Group.objects.get_or_create(name='Default')
u.groups.add(group)
for node in ProcessingNode.objects.all():
    assign_perm('view_processingnode', group, node)
PY
}

write_env() {
  local password="$1"
  touch "$ENV_FILE"
  sed -i '/^WEBODM_\(URL\|USERNAME\|PASSWORD\)=/d' "$ENV_FILE"
  {
    echo "WEBODM_URL=http://localhost:$WEBODM_PORT"
    echo "WEBODM_USERNAME=$SVC_USER"
    echo "WEBODM_PASSWORD=$password"
  } >> "$ENV_FILE"
}

case "${1:-up}" in
  up)
    ensure_checkout
    (cd "$WEBODM_DIR" && ./webodm.sh start --detached --port "$WEBODM_PORT")
    wait_for_webodm
    password="$(service_password)"
    provision_user "$password"
    write_env "$password"
    echo "WebODM ready at http://localhost:$WEBODM_PORT — credentials written to backend/.env"
    ;;
  down)
    (cd "$WEBODM_DIR" && ./webodm.sh stop)
    ;;
  logs)
    (cd "$WEBODM_DIR" && docker compose logs -f)
    ;;
  *)
    echo "usage: $0 [up|down|logs]" >&2
    exit 2
    ;;
esac
