#!/bin/sh
set -eu

compose_file="docker-compose.e2e.yml"
database_url="${TALLY_E2E_DATABASE_URL:-}"
use_compose=0

if [ -z "$database_url" ] && [ -f "apps/api/.env" ]; then
  database_url="$(sed -n 's/^DATABASE_URL=//p' apps/api/.env | head -n 1)"
fi

if [ -z "$database_url" ]; then
  database_url="postgresql://tally:tally@127.0.0.1:55432/tally_e2e"
  use_compose=1
  docker compose -f "$compose_file" up -d --wait
fi

cleanup() {
  if [ "$use_compose" -eq 1 ]; then docker compose -f "$compose_file" down -v; fi
}
trap cleanup EXIT INT TERM

TALLY_E2E_DATABASE_URL="$database_url" \
TALLY_E2E_DETERMINISTIC_ADAPTER=1 \
pnpm exec playwright test "$@"
