#!/usr/bin/env bash
# Generates the Synapse config (first run only) and starts the stack.
set -euo pipefail
cd "$(dirname "$0")"

SERVER_NAME=agents.local

printf 'UID=%s\nGID=%s\n' "$(id -u)" "$(id -g)" > .env
mkdir -p data appservices secrets

if [ ! -f data/homeserver.yaml ]; then
  docker run --rm \
    -v "$PWD/data:/data" \
    -e SYNAPSE_SERVER_NAME="$SERVER_NAME" \
    -e SYNAPSE_REPORT_STATS=no \
    -e UID="$(id -u)" -e GID="$(id -g)" \
    matrixdotorg/synapse:latest generate

  { echo; echo '# --- agent-matrix ---'; cat synapse-overrides.yaml
    printf '%s\n' '# BEGIN appservices (managed by add-person.sh)' 'app_service_config_files: []' '# END appservices'
  } >> data/homeserver.yaml
fi

docker compose up -d
./scripts/wait-for-synapse.sh
echo "Synapse: http://localhost:8008  Element: http://localhost:8080"
