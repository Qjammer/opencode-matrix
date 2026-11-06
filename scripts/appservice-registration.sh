#!/usr/bin/env bash
# Prints a person's appservice registration: it owns the session namespace @<name>.* and may create room aliases.
set -euo pipefail
NAME="${1:?usage: appservice-registration.sh <name> <server name>}"
SERVER_NAME="${2:?usage: appservice-registration.sh <name> <server name>}"
cat <<EOF
id: $NAME-sessions
url: null
as_token: $(python3 -c "import secrets; print(secrets.token_hex(32))")
hs_token: $(python3 -c "import secrets; print(secrets.token_hex(32))")
sender_localpart: $NAME-sessions
rate_limited: false
namespaces:
  users:
    - regex: "@$NAME\\\\..*:$SERVER_NAME"
      exclusive: true
  # Sessions may create team room aliases (#bki-1234); shared by every person, so not exclusive.
  aliases:
    - regex: "#.*:$SERVER_NAME"
      exclusive: false
  rooms: []
EOF
