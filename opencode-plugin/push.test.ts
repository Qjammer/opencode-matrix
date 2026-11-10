import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkTopicPrefix, newTopic, Ntfy, readNtfyToken, Waker } from "./push.ts"

test("topics are random UnifiedPush topics", () => {
  const topic = newTopic()
  expect(topic).toMatch(/^up[A-Za-z0-9]{32}$/)
  expect(newTopic()).not.toBe(topic)
})

test("topics can start with another prefix, short enough for ntfy's 64 characters", () => {
  expect(newTopic("up_jane-doe_")).toMatch(/^up_jane-doe_[A-Za-z0-9]{32}$/)
  expect(() => checkTopicPrefix("up_jane-doe_")).not.toThrow()
  expect(() => checkTopicPrefix("up.jane")).toThrow("topicPrefix")
  expect(() => checkTopicPrefix("")).toThrow("topicPrefix")
  expect(() => checkTopicPrefix("u".repeat(33))).toThrow("topicPrefix")
})

test("an ntfy token file holds only the token", () => {
  const dir = mkdtempSync(join(tmpdir(), "ntfy-token-"))
  writeFileSync(join(dir, "token"), "tk_abc123\n")
  writeFileSync(join(dir, "empty"), "\n")
  expect(readNtfyToken(join(dir, "token"))).toBe("tk_abc123")
  expect(() => readNtfyToken(join(dir, "empty"))).toThrow("ntfy token")
})

test("a wake-up while the loop is busy is kept for its next wait", async () => {
  const waker = new Waker()
  const signal = new AbortController().signal
  waker.wake()
  const start = Date.now()
  await waker.wait(10_000, signal)
  expect(Date.now() - start).toBeLessThan(100)

  const waiting = waker.wait(10_000, signal)
  setTimeout(() => waker.wake(), 20)
  await waiting
  expect(Date.now() - start).toBeLessThan(1_000)
})

test("a wait ends after its timeout or on abort", async () => {
  const waker = new Waker()
  await waker.wait(20, new AbortController().signal)
  const controller = new AbortController()
  const waiting = waker.wait(10_000, controller.signal)
  controller.abort()
  await waiting
})

test("push keys are topics under the base URL; the gateway defaults to the URL's", () => {
  const ntfy = new Ntfy({ url: "https://ntfy.example.org/" }, () => {})
  expect(ntfy.pushkey("upabc")).toBe("https://ntfy.example.org/upabc?up=1")
  expect(ntfy.gateway).toBe("https://ntfy.example.org/_matrix/push/v1/notify")
  expect(new Ntfy({ url: "http://localhost:8090", gateway: "http://ntfy/_matrix/push/v1/notify" }, () => {}).gateway).toBe(
    "http://ntfy/_matrix/push/v1/notify",
  )
})

test("streams subscribe with the token, if there is one", async () => {
  const requests: { path: string; authorization: string | null }[] = []
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push({ path: new URL(request.url).pathname, authorization: request.headers.get("authorization") })
      return new Response(new ReadableStream({ start: (controller) => controller.enqueue('{"event":"open"}\n') }))
    },
  })
  try {
    for (const token of ["tk_abc123", undefined]) {
      const ntfy = new Ntfy({ url: `http://localhost:${server.port}`, token }, () => {})
      const waker = new Waker()
      ntfy.add("up_jane-doe_x", waker)
      // The stream's "open" event wakes every topic it follows.
      await waker.wait(5_000, new AbortController().signal)
      ntfy.stop()
    }
    expect(requests).toEqual([
      { path: "/up_jane-doe_x/json", authorization: "Bearer tk_abc123" },
      { path: "/up_jane-doe_x/json", authorization: null },
    ])
  } finally {
    server.stop(true)
  }
})
