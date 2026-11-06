"""End-to-end check of the one-account-per-session model.

Two session accounts in <person>'s namespace are created through the person's
appservice token, share a room, and exchange a message. The receiver reads it
with its own /sync (no appservice push URL), and the token must be refused
outside its namespace.

Usage: python3 scripts/smoke_test.py <person>
"""

import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = "http://localhost:8008/_matrix/client/v3"
SERVER_NAME = "agents.local"


def read_as_token(person):
    for line in pathlib.Path(f"appservices/{person}.yaml").read_text().splitlines():
        if line.startswith("as_token:"):
            return line.split(":", 1)[1].strip()
    raise SystemExit(f"no as_token in appservices/{person}.yaml")


def call(token, method, path, user_id=None, body=None, query=None):
    query = dict(query or {})
    if user_id:
        query["user_id"] = user_id
    url = BASE_URL + path + ("?" + urllib.parse.urlencode(query) if query else "")
    request = urllib.request.Request(
        url,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


def register(token, localpart):
    status, body = call(
        token,
        "POST",
        "/register",
        body={"type": "m.login.application_service", "username": localpart, "inhibit_login": True},
    )
    if status != 200 and body.get("errcode") != "M_USER_IN_USE":
        raise SystemExit(f"register {localpart} failed: {status} {body}")
    return f"@{localpart}:{SERVER_NAME}"


def check(label, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {label}" + (f"  ({detail})" if detail and not ok else ""))
    return ok


def main():
    person = sys.argv[1] if len(sys.argv) > 1 else "ramiro"
    token = read_as_token(person)
    results = []

    session_a = register(token, f"{person}.smoke_a")
    session_b = register(token, f"{person}.smoke_b")
    results.append(check("session accounts created via appservice", True))

    call(token, "PUT", f"/profile/{session_a}/displayname", session_a, {"displayname": f"{person} · smoke A"})
    call(token, "PUT", f"/profile/{session_b}/displayname", session_b, {"displayname": f"{person} · smoke B"})

    human = f"@{person}:{SERVER_NAME}"
    status, room = call(
        token,
        "POST",
        "/createRoom",
        session_a,
        {"name": f"smoke-test {time.strftime('%H:%M:%S')}", "preset": "private_chat", "invite": [session_b, human]},
    )
    results.append(check("session A creates room and invites B + human", status == 200, room))
    room_id = room["room_id"]

    status, body = call(token, "POST", f"/join/{urllib.parse.quote(room_id)}", session_b, {})
    results.append(check("session B joins", status == 200, body))

    room_filter = json.dumps({"room": {"rooms": [room_id], "timeline": {"limit": 20}}})
    status, sync = call(token, "GET", "/sync", session_b, query={"filter": room_filter, "timeout": "0"})
    results.append(check("session B can /sync as itself (url: null)", status == 200, sync))
    since = sync["next_batch"]

    marker = f"smoke-{time.time_ns()}"
    content = {
        "msgtype": "m.text",
        "body": "BKI-0000: hello from session A",
        "com.innovamat.agent": {"type": "fyi", "refs": ["BKI-0000"], "marker": marker},
    }
    status, body = call(token, "PUT", f"/rooms/{urllib.parse.quote(room_id)}/send/m.room.message/{marker}", session_a, content)
    results.append(check("session A sends structured message", status == 200, body))

    status, sync = call(
        token, "GET", "/sync", session_b, query={"filter": room_filter, "since": since, "timeout": "10000"}
    )
    events = sync.get("rooms", {}).get("join", {}).get(room_id, {}).get("timeline", {}).get("events", [])
    received = [e for e in events if e.get("content", {}).get("com.innovamat.agent", {}).get("marker") == marker]
    results.append(check("session B receives it via long-poll /sync", bool(received), events))
    if received:
        results.append(check("sender is session A", received[0]["sender"] == session_a, received[0]["sender"]))

    outsider = f"@not{person}.intruder:{SERVER_NAME}"
    status, body = call(token, "GET", "/account/whoami", outsider)
    results.append(check(f"token refused outside its namespace ({outsider})", status in (401, 403), f"{status} {body}"))

    print(f"\nRoom {room_id} — open http://localhost:8080 as {human} to see it.")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
