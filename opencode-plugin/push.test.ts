import { expect, test } from "bun:test"
import { newTopic, Ntfy, Waker } from "./push.ts"

test("topics are random UnifiedPush topics", () => {
  const topic = newTopic()
  expect(topic).toMatch(/^up[A-Za-z0-9]{32}$/)
  expect(newTopic()).not.toBe(topic)
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
  const ntfy = new Ntfy("https://ntfy.example.org/", undefined, () => {})
  expect(ntfy.pushkey("upabc")).toBe("https://ntfy.example.org/upabc?up=1")
  expect(ntfy.gateway).toBe("https://ntfy.example.org/_matrix/push/v1/notify")
  expect(new Ntfy("http://localhost:8090", "http://ntfy/_matrix/push/v1/notify", () => {}).gateway).toBe("http://ntfy/_matrix/push/v1/notify")
})
