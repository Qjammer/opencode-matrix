// The plugin's GUI part (OpenCode 2.2+, desktop and web): a "Matrix" tab in each session's side region with the
// session's rooms and their latest messages, read through the server part's RPC. Built into
// dist/gui-experimental.cjs by vite.config.ts.
import { createSignal, For, onCleanup, Show } from "solid-js"
import { Command, createLatest, MenuItem, Panel, Plugin, usePlugin, type MountedSession, type PanelTab } from "@opencode/plugin/gui"
import { AgentMatrixRpc, type SessionMessages } from "./rpc.ts"

/** Refetches this often even without an `updated` event, which a disconnected client misses. */
const REFRESH_MS = 30_000

const definition = Plugin.define({
  i18n: {
    en: {
      title: "Matrix",
      open: "Show Matrix messages",
      refresh: "Refresh",
      none: "This session hasn't used Matrix yet.",
      empty: "No messages yet.",
      failed: "Couldn't load the session's Matrix messages.",
    },
  },
})

function Messages(props: { readonly session: MountedSession }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const [version, setVersion] = createSignal(0)
  const refresh = () => setVersion((value) => value + 1)

  const unsubscribe = ctx.client.rpc(AgentMatrixRpc).events.on("updated", (event) => {
    if ((event.data as { sessionID: string }).sessionID === props.session.id) refresh()
  })
  const timer = setInterval(refresh, REFRESH_MS)
  onCleanup(() => {
    unsubscribe()
    clearInterval(timer)
  })

  const data = createLatest(
    () => ({ id: props.session.id, location: props.session.location, version: version() }),
    (input) =>
      ctx.client
        .rpc(AgentMatrixRpc)
        .session({ sessionID: input.id }, input.location ? { location: input.location as never } : undefined) as Promise<SessionMessages>,
  )

  const time = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })

  return (
    <div style={{ padding: "8px 12px", overflow: "auto", height: "100%" }}>
      <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "8px" }}>
        <span style={{ flex: "1", opacity: "0.7", "font-size": "12px" }}>{data.latest?.account ?? ""}</span>
        <ui.Tooltip value={ctx.t("refresh")}>
          <ui.IconButton icon="outline-rotate-clockwise" label={ctx.t("refresh")} onClick={refresh} />
        </ui.Tooltip>
      </div>
      <Show when={!data.error} fallback={<p>{ctx.t("failed")}</p>}>
        <Show when={data.latest} fallback={<ui.Loader size="large" />}>
          {(latest) => (
            <Show when={latest().account} fallback={<p>{ctx.t("none")}</p>}>
              <Show when={latest().rooms.length} fallback={<p>{ctx.t("empty")}</p>}>
                <For each={latest().rooms}>
                  {(room) => (
                    <section style={{ "margin-bottom": "16px" }}>
                      <h3 style={{ "font-size": "13px", margin: "0 0 6px" }}>{room.label}</h3>
                      <For each={room.messages}>
                        {(message) => (
                          <div style={{ "margin-bottom": "8px" }}>
                            <div style={{ "font-size": "12px", opacity: "0.7" }}>
                              {message.senderName ?? message.sender} · {message.relation} · {time(message.time)}
                            </div>
                            <div style={{ "white-space": "pre-wrap", "overflow-wrap": "anywhere" }}>{message.body}</div>
                          </div>
                        )}
                      </For>
                    </section>
                  )}
                </For>
              </Show>
            </Show>
          )}
        </Show>
      </Show>
    </div>
  )
}

export default Plugin.define({
  ...definition,
  setup(ctx) {
    const tab: PanelTab = {
      id: "messages",
      get title() {
        return ctx.t("title")
      },
      closable: "compact",
    }
    const key = `${ctx.id}:messages`

    ctx.add(Panel, {
      id: "messages",
      region: "side",
      list: (input) => (input.open.includes("messages") ? [tab] : []),
      render: (props) => <Messages session={props.session} />,
    })

    ctx.add(MenuItem, (): MenuItem => {
      const session = ctx.sessions.current()
      return {
        menu: "session.panel",
        id: "messages",
        title: ctx.t("title"),
        icon: "speech-bubble",
        keybind: `${ctx.id}.messages`,
        opened: !!session && ctx.layout.state(key, session) !== "closed",
        run: () => {
          if (session) ctx.layout.open(key, session)
        },
      }
    })

    ctx.add(
      Command,
      (): Command => ({
        id: "messages",
        title: ctx.t("open"),
        keywords: "matrix chat messages",
        enabled: !!ctx.sessions.current(),
        run: () => {
          const session = ctx.sessions.current()
          if (session) ctx.layout.toggle(key, session)
        },
      }),
    )
  },
})
