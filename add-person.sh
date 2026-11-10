#!/usr/bin/env bash
# Adds a person: a human account (@<name>) for Element and an appservice that owns that person's agent accounts,
# named like the plugin's `localpart` option (default {person}.{name}, so @<name>.*).
#
# Usage: ./add-person.sh <name> [--localpart TEMPLATE] [--not-exclusive] [--ntfy-token]
#   --localpart '{person}+{name}'   agent accounts are @<name>+ses_..., as on servers where names contain dots
#   --not-exclusive                 other accounts may be created in the namespace too (homeservers only send
#                                   push notifications to non-exclusive appservice users); sessions would describe
#                                   them as the person's agents
#   --ntfy-token                    an ntfy user and token for the person, as on an ntfy server that restricts
#                                   reading push topics: anyone may still publish on up* topics, but only the
#                                   person's token may read theirs (up_<name>_*, dots as "-"). This applies to
#                                   everyone's up* topics on the stack's ntfy.
set -euo pipefail
cd "$(dirname "$0")"

USAGE="usage: ./add-person.sh <name> [--localpart TEMPLATE] [--not-exclusive] [--ntfy-token]"
NAME="${1:?$USAGE}"
shift
LOCALPART='{person}.{name}'
EXCLUSIVE=true
NTFY_TOKEN=false
while [ $# -gt 0 ]; do
  case "$1" in
    --localpart) LOCALPART="${2:?$USAGE}"; shift 2 ;;
    --not-exclusive) EXCLUSIVE=false; shift ;;
    --ntfy-token) NTFY_TOKEN=true; shift ;;
    *) echo "$USAGE" >&2; exit 1 ;;
  esac
done
SERVER_NAME=agents.local

if [ ! -f "appservices/$NAME.yaml" ]; then
  scripts/appservice-registration.sh "$NAME" "$SERVER_NAME" "$LOCALPART" "$EXCLUSIVE" > "appservices/$NAME.yaml"
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
echo "Agent accounts: @${LOCALPART/\{person\}/$NAME}:$SERVER_NAME, {name} being ses_<id> or the dispatcher"
echo "Appservice token in appservices/$NAME.yaml"

if [ "$NTFY_TOKEN" = true ]; then
  TOPIC_PREFIX="up_${NAME//./-}_"
  if [ ! -f "secrets/$NAME-ntfy-token" ]; then
    # The password is never used: the plugin subscribes with the token.
    docker compose exec -T -e NTFY_PASSWORD="$(openssl rand -base64 18)" ntfy ntfy user add "$NAME" > /dev/null
    docker compose exec -T ntfy ntfy access everyone 'up*' write-only > /dev/null
    docker compose exec -T ntfy ntfy access "$NAME" "${TOPIC_PREFIX}*" read-write > /dev/null
    (umask 077 && docker compose exec -T ntfy ntfy token add "$NAME" | grep -o 'tk_[A-Za-z0-9]*' > "secrets/$NAME-ntfy-token")
  fi
  echo "ntfy token in secrets/$NAME-ntfy-token, for topics starting with $TOPIC_PREFIX"
fi
