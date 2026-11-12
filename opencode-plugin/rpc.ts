// The RPC between the plugin's server part and its GUI (OpenCode 2.2+). A plain object in the shape of
// `Rpc.define` from "@opencode/plugin/rpc", which only checks error names and returns its argument; see the note
// above the default export in index.ts.

export const AgentMatrixRpc = {
  id: "agent-matrix",
  methods: {
    /** A session's Matrix rooms with their latest messages. Doesn't create the session's account. */
    session: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: { type: "object" },
    },
  },
  events: {
    /** A session's account sent or received messages. */
    updated: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
    },
  },
} as const

export interface SessionMessages {
  /** The session's account, or null if it hasn't used Matrix yet. */
  account: string | null
  /** Most recently active first. */
  rooms: RoomMessages[]
}

export interface RoomMessages {
  roomId: string
  label: string
  /** Oldest first. */
  messages: MessageView[]
}

export interface MessageView {
  eventId: string
  sender: string
  senderName?: string
  /** How the sender relates to the session: "you", "your user (...)", "another of your user's agent sessions"... */
  relation: string
  /** Milliseconds since the epoch. */
  time: number
  body: string
}
