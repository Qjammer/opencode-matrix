#!/usr/bin/env bash
# Adds a person: a human account (@<name>) for Element and an appservice that
# owns the session namespace @<name>.* for that person's agent sessions.
set -euo pipefail
cd "$(dirname "$0")"

NAME="${1:?usage: ./add-person.sh <name>}"
SERVER_NAME=agents.local

if [ ! -f "appservices/$NAME.yaml" ]; then
  scripts/appservice-registration.sh "$NAME" "$SERVER_NAME" > "appservices/$NAME.yaml"
fi

# Synapse only reads appservice registrations at startup: rewrite the list and restart.
python3 - <<'EOF'
import pathlib, re
config = pathlib.Path("data/homeserver.yaml")
files = sorted(p.name for p in pathlib.Path("appservices").glob("*.yaml"))
block = "app_service_config_files:\n" + "".join(f"  - /appservices/{f}\n" for f in files)
text = re.sub(
    r"(# BEGIN appservices.*?\n).*?(# END appservices)",
    lambda m: m.group(1) + block + m.group(2),
    config.read_text(),
    flags=re.S,
)
config.write_text(text)
EOF

docker compose restart synapse
./scripts/wait-for-synapse.sh

if [ ! -f "secrets/$NAME-password" ]; then
  PASSWORD="$(openssl rand -base64 18)"
  docker compose exec -T synapse register_new_matrix_user \
    -c /data/homeserver.yaml -u "$NAME" -p "$PASSWORD" -a http://localhost:8008
  echo "$PASSWORD" > "secrets/$NAME-password"
  chmod 600 "secrets/$NAME-password"
fi

echo "Human account: @$NAME:$SERVER_NAME (password in secrets/$NAME-password)"
echo "Session namespace: @$NAME.*:$SERVER_NAME (token in appservices/$NAME.yaml)"
