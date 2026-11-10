import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"

// Wake-ups through ntfy instead of long-polling /sync. Each account has a pusher that sends its notifications to
// a secret ntfy topic (the homeserver posts to ntfy's Matrix push gateway); one stream per TOPICS_PER_STREAM
// topics wakes the account's sync loop, which then syncs from its stored position. A notification carries nothing
// the loop needs, so a missed one only delays delivery until the next wake-up.

const TOPICS_PER_STREAM = 100
/** ntfy sends a keepalive every 45 s by default: a stream silent for longer than this is dead. */
const STREAM_IDLE_MS = 120_000
const RETRY_MS = 5_000
/** Changes to the topics within this delay share one reconnect. */
const RESTART_DELAY_MS = 1_000

/** An ntfy access token (`tk_...`) from a file holding only the token. */
export function readNtfyToken(file: string) {
  const token = readFileSync(file, "utf8").trim()
  if (!/^\S+$/.test(token)) throw new Error(`${file} doesn't hold an ntfy token`)
  return token
}

export const DEFAULT_TOPIC_PREFIX = "up"

/** ntfy topics are at most 64 of these characters, and the random part takes 32. */
export function checkTopicPrefix(prefix: string) {
  if (!/^[-_A-Za-z0-9]{1,32}$/.test(prefix)) throw new Error(`ntfy topicPrefix "${prefix}" must be 1 to 32 letters, digits, "-" or "_"`)
}

/** A random topic: the prefix (a UnifiedPush `up` by default) and 32 letters and digits (190 bits). */
export function newTopic(prefix = DEFAULT_TOPIC_PREFIX) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  return prefix + [...randomBytes(32)].map((byte) => alphabet[byte % alphabet.length]).join("")
}

/** Wakes a sync loop. A wake-up while the loop is busy is kept for its next wait. */
export class Waker {
  private woken = false
  private done?: () => void

  wake() {
    this.woken = true
    this.done?.()
  }

  /** Resolves once woken (at once if woken since the last wait), after `ms`, or on abort. */
  wait(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      if (this.woken || signal.aborted) {
        this.woken = false
        return resolve()
      }
      const done = () => {
        clearTimeout(timer)
        signal.removeEventListener("abort", done)
        this.done = undefined
        this.woken = false
        resolve()
      }
      const timer = setTimeout(done, ms)
      signal.addEventListener("abort", done, { once: true })
      this.done = done
    })
  }
}

export class Ntfy {
  private readonly topics = new Map<string, Waker>()
  private streams: AbortController[] = []
  private restart?: ReturnType<typeof setTimeout>

  readonly url: string
  readonly gateway: string
  private readonly headers: Record<string, string>

  /**
   * `url` must be the ntfy server's base-url, which it requires as the push keys' prefix. `token`, if given, is an
   * ntfy access token the streams subscribe with.
   */
  constructor(
    { url, gateway, token }: { url: string; gateway?: string; token?: string },
    private readonly log: (...args: unknown[]) => void,
  ) {
    this.url = url.replace(/\/+$/, "")
    this.gateway = gateway ?? `${this.url}/_matrix/push/v1/notify`
    this.headers = token ? { Authorization: `Bearer ${token}` } : {}
  }

  pushkey(topic: string) {
    return `${this.url}/${topic}?up=1`
  }

  add(topic: string, waker: Waker) {
    this.topics.set(topic, waker)
    this.scheduleRestart()
  }

  remove(topic: string) {
    if (this.topics.delete(topic)) this.scheduleRestart()
  }

  stop() {
    clearTimeout(this.restart)
    for (const controller of this.streams) controller.abort()
    this.streams = []
  }

  private scheduleRestart() {
    clearTimeout(this.restart)
    this.restart = setTimeout(() => this.start(), RESTART_DELAY_MS)
  }

  private start() {
    this.stop()
    const topics = [...this.topics.keys()]
    for (let i = 0; i < topics.length; i += TOPICS_PER_STREAM) {
      const controller = new AbortController()
      this.streams.push(controller)
      void this.stream(topics.slice(i, i + TOPICS_PER_STREAM), controller.signal)
    }
  }

  /** Follows the topics until aborted, reconnecting when the stream fails or ends. */
  private async stream(topics: string[], signal: AbortSignal) {
    while (!signal.aborted) {
      const request = new AbortController()
      const abort = () => request.abort()
      signal.addEventListener("abort", abort, { once: true })
      let idle = setTimeout(abort, STREAM_IDLE_MS)
      try {
        const response = await fetch(`${this.url}/${topics.join(",")}/json`, { headers: this.headers, signal: request.signal })
        if (!response.ok || !response.body) throw new Error(`ntfy: ${response.status}`)
        let buffer = ""
        for await (const chunk of response.body.pipeThrough(new TextDecoderStream()) as unknown as AsyncIterable<string>) {
          clearTimeout(idle)
          idle = setTimeout(abort, STREAM_IDLE_MS)
          buffer += chunk
          const lines = buffer.split("\n")
          buffer = lines.pop()!
          for (const line of lines) if (line.trim()) this.handle(topics, JSON.parse(line))
        }
      } catch (error) {
        if (!signal.aborted) this.log("ntfy stream error", error)
      } finally {
        clearTimeout(idle)
        signal.removeEventListener("abort", abort)
      }
      if (!signal.aborted) await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
    }
  }

  private handle(topics: string[], event: { event?: string; topic?: string }) {
    // Notifications sent while the stream was down are not replayed: every loop catches up on (re)connecting.
    if (event.event === "open") for (const topic of topics) this.topics.get(topic)?.wake()
    else if (event.event === "message" && event.topic) this.topics.get(event.topic)?.wake()
  }
}
