import { expect, test } from "bun:test"
import { checkClientPath } from "./matrix.ts"
import { categories, describeOperation, findOperations, operations, searchOperations, specURL } from "./openapi.ts"

const spec = {
  paths: {
    "/_matrix/client/v3/rooms/{roomId}/state/{eventType}/{stateKey}": {
      get: { summary: "Get the state identified by the type and key.", tags: ["Room participation"], responses: {} },
      put: { summary: "Send a state event to the given room.", tags: ["Room participation"], responses: {} },
    },
    "/_matrix/client/v3/rooms/{roomId}/redact/{eventId}/{txnId}": {
      put: {
        summary: "Strips all non-integrity-critical information out of an event.",
        tags: ["Room participation"],
        security: [{ accessTokenQuery: [] }],
        parameters: [{ name: "roomId", in: "path", required: true, example: "!a:x", schema: { type: "string", example: "!a:x" } }],
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { reason: { type: "string" } }, example: { reason: "spam" } } } },
        },
        responses: {
          "200": {
            description: "An ID for the redaction event.",
            content: { "application/json": { schema: { type: "object" }, examples: { response: { value: { event_id: "$e" } } } } },
          },
          "429": { description: "This request was rate-limited.", content: { "application/json": { schema: { type: "object" } } } },
        },
      },
    },
    "/_matrix/client/v3/account/whoami": { get: { summary: "Gets information about the owner of an access token.", tags: ["Session management"] } },
  },
}
const all = operations(spec)

test("the spec version is the newest stable one the homeserver supports", () => {
  expect(specURL(["r0.6.1", "v1.9", "v1.15", "v1.2"])).toBe("https://spec.matrix.org/v1.15/client-server-api/api.json")
  expect(specURL(undefined)).toBe("https://spec.matrix.org/latest/client-server-api/api.json")
})

test("endpoints are found by template or concrete path, and by words", () => {
  const state = "/_matrix/client/v3/rooms/{roomId}/state/{eventType}/{stateKey}"
  expect(findOperations(all, state).map((op) => op.method)).toEqual(["GET", "PUT"])
  expect(findOperations(all, state, "put").map((op) => op.method)).toEqual(["PUT"])
  expect(findOperations(all, "/_matrix/client/v3/rooms/%21a%3Ax/state/m.room.topic/?user_id=x", "GET")).toHaveLength(1)
  expect(findOperations(all, "/_matrix/client/v3/rooms/!a:x/redact/$e/1")[0].path).toContain("/redact/")
  expect(findOperations(all, "/_matrix/client/v3/nope")).toEqual([])
  expect(searchOperations(all, "state SEND").map((op) => op.method)).toEqual(["PUT"])
  expect(categories(all)).toEqual(["Room participation (3)", "Session management (1)"])
})

test("operations are described compactly", () => {
  const [redact] = findOperations(all, "/_matrix/client/v3/rooms/{roomId}/redact/{eventId}/{txnId}")
  expect(describeOperation(redact)).toEqual({
    endpoint: "PUT /_matrix/client/v3/rooms/{roomId}/redact/{eventId}/{txnId}",
    summary: "Strips all non-integrity-critical information out of an event.",
    description: undefined,
    authenticated: true,
    parameters: [{ name: "roomId", in: "path", required: true, description: undefined, schema: { type: "string" } }],
    request: { schema: { type: "object", properties: { reason: { type: "string" } } }, example: { reason: "spam" } },
    responses: {
      "200": { description: "An ID for the redaction event.", schema: { type: "object" }, example: { event_id: "$e" } },
      "429": "This request was rate-limited.",
    },
  })
})

test("matrix_api paths stay in the client API and away from registration and login", () => {
  expect(checkClientPath("/_matrix/client/v3/rooms/%21a%3Ax/state/m.room.topic/")).toBeTruthy()
  expect(() => checkClientPath("/_synapse/admin/v1/users")).toThrow()
  expect(() => checkClientPath("/_matrix/client/v3/../../_synapse/admin/v1/users")).toThrow()
  expect(() => checkClientPath("/_matrix/client/v3/%2e%2e/%2e%2e/_synapse/admin")).toThrow()
  expect(() => checkClientPath("/_matrix/client/v3/sync?since=x")).toThrow("query")
  expect(() => checkClientPath("/_matrix/client/v3/register")).toThrow("not allowed")
  expect(() => checkClientPath("/_matrix/client/v1/login/get_token")).toThrow("not allowed")
})
