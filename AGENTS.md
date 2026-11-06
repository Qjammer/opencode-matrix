# opencode-matrix

The `agent-matrix` OpenCode plugin: one Matrix account per OpenCode session, plus a dispatcher account that starts
a new session for every message from its person. The plugin is in `opencode-plugin/` (see its README); `README.md`
and the root scripts are the local Synapse used to develop it.

## Usage

DM the dispatcher, `@<person>.agent:<server>` by default (or mention it in a room it is in). Each message starts a
session; the session's own account invites you to a DM, which is the conversation from then on. The dispatcher declines
invites from anyone but `@<person>`. If a session fails (e.g. the model provider rejects the request), it posts the
error in that DM.

```
agent=plan dir=web/api model=sonnet#high why is the login test flaky?   # options first, then the prompt
!help                         # agents, directories, models
!sessions                     # recent sessions with links to their DMs
!default dir=web/api          # this room's defaults (!default clear)
```

In a session's DM: `!status`, `!agent <agent>`, `!model <model>[#variant]`, `!rename <name>`, `!stop`, `!help`. Anything else goes
to the session.

## Tests

`cd opencode-plugin && bun install && bun test` after `./setup.sh && ./add-person.sh ramiro` (local Synapse on :8008).

CI (`.github/workflows/ci.yml`, GitHub Actions) runs the same on every push and pull request, on a fresh stack. A
second job runs the tests as `john.smith` with `localpart` `{person}+{name}` in a non-exclusive namespace:
`./add-person.sh john.smith --localpart '{person}+{name}' --not-exclusive`, then `bun test` with `TEST_PERSON` and
`TEST_LOCALPART` set to match.

The same workflow packs the plugin (`npm pack`, with the repository's LICENSE) on every run. Pushing a tag `v<version>`
matching `opencode-plugin/package.json` creates a GitHub release with that package, once the tests pass.
