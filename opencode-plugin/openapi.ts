// Lookups in the Matrix Client-Server API's OpenAPI description, for agents using matrix_api. The spec
// (spec.matrix.org/<version>/client-server-api/api.json) has its schemas inlined, so an operation stands alone.

export interface Operation {
  method: string
  path: string
  summary: string
  tags: string[]
  operation: any
}

const METHODS = ["get", "put", "post", "delete", "patch"]
export const MAX_RESULTS = 50

/** The spec URL for the newest stable version a homeserver supports (its `/versions` response). */
export function specURL(versions: unknown) {
  const minors = (Array.isArray(versions) ? versions : [])
    .map((version) => /^v1\.(\d+)$/.exec(String(version))?.[1])
    .filter((minor): minor is string => minor !== undefined)
    .map(Number)
  const version = minors.length ? `v1.${Math.max(...minors)}` : "latest"
  return `https://spec.matrix.org/${version}/client-server-api/api.json`
}

export function operations(spec: any): Operation[] {
  const out: Operation[] = []
  for (const [path, item] of Object.entries<any>(spec?.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item?.[method]
      if (!operation) continue
      out.push({ method: method.toUpperCase(), path, summary: operation.summary ?? "", tags: operation.tags ?? [], operation })
    }
  }
  return out
}

/** Accepts the templated path or a concrete one (IDs filled in, URL-encoded or not), with or without a query. */
export function findOperations(all: readonly Operation[], path: string, method?: string) {
  const wanted = path.trim().split("?")[0]
  const matches = all.filter((op) => {
    if (method && op.method !== method.toUpperCase()) return false
    if (op.path === wanted) return true
    const pattern = op.path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]*")
    return new RegExp(`^${pattern}$`).test(wanted)
  })
  // A literal segment beats a placeholder: /rooms/{roomId}/state/m.room.name matches both state endpoints.
  const literal = matches.filter((op) => op.path === wanted)
  return literal.length ? literal : matches
}

export function searchOperations(all: readonly Operation[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return all.filter((op) => {
    const haystack = `${op.method} ${op.path} ${op.summary} ${op.tags.join(" ")}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

export function listLine(op: Operation) {
  return `${op.method} ${op.path} — ${op.summary}`
}

export function categories(all: readonly Operation[]) {
  const counts = new Map<string, number>()
  for (const op of all) for (const tag of op.tags.length ? op.tags : ["Other"]) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).map(([tag, count]) => `${tag} (${count})`)
}

/** Drops nested examples; the request and success response keep one example each. */
function stripExamples(value: any): any {
  if (Array.isArray(value)) return value.map(stripExamples)
  if (!value || typeof value !== "object") return value
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    if (key === "example" || key === "examples") continue
    out[key] = stripExamples(inner)
  }
  return out
}

function firstExample(media: any) {
  if (!media) return undefined
  if (media.example !== undefined) return media.example
  if (media.schema?.example !== undefined) return media.schema.example
  const examples = Object.values<any>(media.examples ?? {})
  return examples[0]?.value
}

function body(content: any) {
  const [type, media] = Object.entries<any>(content ?? {})[0] ?? []
  if (!type) return undefined
  const example = firstExample(media)
  return {
    ...(type === "application/json" ? {} : { content_type: type }),
    schema: stripExamples(media?.schema),
    ...(example === undefined ? {} : { example }),
  }
}

/** A compact form of an operation: errors keep only their description, which is what agents act on. */
export function describeOperation(op: Operation) {
  const { operation } = op
  const responses: Record<string, unknown> = {}
  for (const [status, response] of Object.entries<any>(operation.responses ?? {})) {
    responses[status] = status.startsWith("2") ? { description: response.description, ...body(response.content) } : response.description
  }
  return {
    endpoint: `${op.method} ${op.path}`,
    summary: op.summary,
    description: operation.description,
    authenticated: Boolean(operation.security?.length),
    ...(operation.deprecated ? { deprecated: true } : {}),
    parameters: operation.parameters?.map((parameter: any) => ({
      name: parameter.name,
      in: parameter.in,
      ...(parameter.required ? { required: true } : {}),
      description: parameter.description,
      schema: stripExamples(parameter.schema),
    })),
    ...(operation.requestBody ? { request: body(operation.requestBody.content) } : {}),
    responses,
  }
}
