#!/usr/bin/env bash
set -euo pipefail

for _ in $(seq 1 60); do
  if curl -fsS http://localhost:8008/health >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done
echo "Synapse did not become healthy in 60s; check: docker compose logs synapse" >&2
exit 1
