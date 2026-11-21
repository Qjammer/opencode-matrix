import { expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { anchorHolds, canonicalJSON, isMachineID, loadMachineKey, SIGNED_FIELD, signEvent, verifyEvent } from "./machine.ts"

const directory = mkdtempSync(join(tmpdir(), "machine-"))
function keyFile(name: string, type: "ed25519" | "x25519" = "ed25519") {
  const path = join(directory, name)
  writeFileSync(path, generateKeyPairSync(type as "ed25519").privateKey.export({ format: "pem", type: "pkcs8" }))
  return path
}

const key = loadMachineKey(keyFile("homelab.pem"))
const other = loadMachineKey(keyFile("laptop.pem"))
const room = "!room:agents.local"
const sender = "@ramiro.ses_a:agents.local"

function signed(content: Record<string, unknown> = { msgtype: "m.text", body: "Go ahead" }, anchor = "$anchor", signer = key) {
  return { type: "m.room.message", sender, event_id: "$signed", content: signEvent(signer, { roomId: room, sender, type: "m.room.message", content }, anchor) }
}

test("canonical JSON sorts keys and has no whitespace", () => {
  expect(canonicalJSON({ b: 1, a: { d: [true, null], c: "x" } })).toBe('{"a":{"c":"x","d":[true,null]},"b":1}')
})

test("machine keys are Ed25519 keys, identified by their public key", () => {
  expect(isMachineID(key.id)).toBe(true)
  expect(key.id).not.toBe(other.id)
  expect(() => loadMachineKey(keyFile("x.pem", "x25519"))).toThrow("not an Ed25519 private key")
  expect(isMachineID("not a key")).toBe(false)
})

test("a signed event verifies unchanged, in its room, from its sender", () => {
  const event = signed()
  expect(verifyEvent(room, event)).toEqual({ machine: key.id, anchor: "$anchor" })
  // A JSON round trip (the homeserver's) changes nothing.
  expect(verifyEvent(room, JSON.parse(JSON.stringify(event)))).toEqual({ machine: key.id, anchor: "$anchor" })
  expect(verifyEvent("!elsewhere:agents.local", event)).toBeUndefined()
  expect(verifyEvent(room, { ...event, sender: "@ramiro.ses_b:agents.local" })).toBeUndefined()
  expect(verifyEvent(room, { ...event, type: "m.reaction" })).toBeUndefined()
  expect(verifyEvent(room, { ...event, content: { ...event.content, body: "Stop" } })).toBeUndefined()
  const field = event.content[SIGNED_FIELD] as any
  expect(verifyEvent(room, { ...event, content: { ...event.content, [SIGNED_FIELD]: { ...field, anchor: "$later" } } })).toBeUndefined()
  // Passed off as another machine's.
  expect(verifyEvent(room, { ...event, content: { ...event.content, [SIGNED_FIELD]: { ...field, machine: other.id } } })).toBeUndefined()
  for (const junk of [undefined, null, {}, { ...event, content: { body: "unsigned" } }, { ...event, content: { ...event.content, [SIGNED_FIELD]: { ...field, signature: "!!" } } }]) {
    expect(verifyEvent(room, junk)).toBeUndefined()
  }
})

test("an event must follow its anchor with nothing from its sender in between", () => {
  const event = signed()
  const anchor = { event_id: "$anchor", sender: "@ramiro:agents.local" }
  const someone = { event_id: "$other", sender: "@marta:agents.local" }
  expect(anchorHolds(event, "$anchor", [anchor])).toBe(true)
  expect(anchorHolds(event, "$anchor", [someone, someone, anchor])).toBe(true)
  // Its own state changes (a join, a new display name) don't matter.
  expect(anchorHolds(event, "$anchor", [{ event_id: "$join", sender, state_key: sender }, anchor])).toBe(true)
  // A replay: the original, even redacted, is in between.
  expect(anchorHolds(event, "$anchor", [someone, { event_id: "$original", sender, content: {} }, anchor])).toBe(false)
  // The anchor is too far back, or not in the room.
  expect(anchorHolds(event, "$anchor", [someone, someone])).toBe(false)
  expect(anchorHolds(event, "$anchor", [])).toBe(false)
})
