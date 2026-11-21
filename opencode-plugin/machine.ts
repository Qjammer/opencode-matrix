import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto"
import { readFileSync } from "node:fs"

// Machine keys: each machine running agents has an Ed25519 key pair and signs every event its agents send. Whose
// machine a key is, each machine decides for itself (its trust list). Keys and signatures are unpadded base64, as in
// the rest of Matrix.
//
// The signature covers the event (type, content, sender, room) and an anchor: the room's latest event when it was sent.
// A copy of a signed event, sent again as the same account, carries the same anchor with the original in between, so
// it is rejected: the room's own order makes signed events impossible to replay.

/** The content field holding an event's signature, and the `type` of what is signed. */
export const SIGNED_FIELD = "io.github.qjammer.agent_matrix.signed"

export interface Signed {
  /** The machine's public key. */
  machine: string
  /** The room's latest event when this one was sent. */
  anchor: string
  signature: string
}

export interface MachineKey {
  /** Public key, unpadded base64. */
  id: string
  privateKey: KeyObject
}

const unpadded = (data: Buffer) => data.toString("base64").replace(/=+$/, "")

/** Canonical JSON (Matrix appendix): keys sorted, no whitespace. */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJSON(item)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

/** An Ed25519 private key in PEM (PKCS#8, as `openssl genpkey -algorithm ed25519` writes it). */
export function loadMachineKey(file: string): MachineKey {
  const privateKey = createPrivateKey(readFileSync(file, "utf8"))
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error(`${file} is not an Ed25519 private key`)
  const raw = Buffer.from(createPublicKey(privateKey).export({ format: "jwk" }).x!, "base64url")
  return { id: unpadded(raw), privateKey }
}

/** A machine key as given by a person: 32 bytes of base64. */
export function isMachineID(text: string) {
  return /^[A-Za-z0-9+/]{43}$/.test(text) && Buffer.from(text, "base64").length === 32
}

export interface UnsignedEvent {
  roomId: string
  sender: string
  type: string
  content: Record<string, unknown>
}

function signedBytes({ roomId, sender, type, content }: UnsignedEvent, machine: string, anchor: string) {
  const { [SIGNED_FIELD]: _, ...rest } = content
  return Buffer.from(canonicalJSON({ type: SIGNED_FIELD, room_id: roomId, sender, event_type: type, content: rest, machine, anchor }))
}

/** `event`'s content with its signature added. */
export function signEvent(key: MachineKey, event: UnsignedEvent, anchor: string): Record<string, unknown> {
  const signature = unpadded(sign(null, signedBytes(event, key.id, anchor), key.privateKey))
  return { ...event.content, [SIGNED_FIELD]: { machine: key.id, anchor, signature } satisfies Signed }
}

/** The machine and anchor of a received event (as /sync and /messages return it), if its signature verifies. */
export function verifyEvent(roomId: string, event: any): { machine: string; anchor: string } | undefined {
  const content = event?.content
  const { machine, anchor, signature } = (content?.[SIGNED_FIELD] ?? {}) as Partial<Signed>
  if (typeof machine !== "string" || typeof anchor !== "string" || typeof signature !== "string" || !isMachineID(machine)) return undefined
  if (typeof event.sender !== "string" || typeof event.type !== "string") return undefined
  try {
    const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(machine, "base64").toString("base64url") }, format: "jwk" })
    const data = signedBytes({ roomId, sender: event.sender, type: event.type, content }, machine, anchor)
    return verify(null, data, publicKey, Buffer.from(signature, "base64")) ? { machine, anchor } : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether `event` was sent right after its anchor: `before` (the events before it, newest first) reaches the anchor
 * with nothing from the same sender in between. A replay has its original (or the original's redaction) in between.
 * State events don't count: joins and display name changes are not messages that could be replayed.
 */
export function anchorHolds(event: any, anchor: string, before: readonly any[]) {
  for (const earlier of before) {
    if (earlier.event_id === anchor) return true
    if (earlier.sender === event.sender && earlier.state_key === undefined) return false
  }
  return false
}
