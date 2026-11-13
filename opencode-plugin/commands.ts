import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

// Chat commands: `!name args` messages, and `key=value` options at the start of a message to the dispatcher.

export const OPTION_KEYS = ["agent", "dir", "model"] as const
export type StartOptions = Partial<Record<(typeof OPTION_KEYS)[number], string>>

export interface Command {
  name: string
  args: string
}

/** `!name args`, or undefined for an ordinary message. */
export function parseCommand(text: string): Command | undefined {
  const match = /^!(\w+)\s*([\s\S]*)$/.exec(text.trim())
  return match ? { name: match[1].toLowerCase(), args: match[2].trim() } : undefined
}

/** Leading `agent=`, `dir=` and `model=` tokens; parsing stops at the first other word, which starts the prompt. */
export function parseOptions(text: string): { options: StartOptions; rest: string } {
  const options: StartOptions = {}
  let rest = text.trim()
  for (;;) {
    const match = /^(\w+)=(\S+)\s*/.exec(rest)
    const key = match?.[1].toLowerCase() as keyof StartOptions | undefined
    if (!match || !OPTION_KEYS.includes(key as any)) break
    options[key!] = match[2]
    rest = rest.slice(match[0].length)
  }
  return { options, rest }
}

export interface AgentInfo {
  id: string
  mode: string
  hidden?: boolean
}

/** Agents a session can run as; subagents and internal agents (title, compaction...) are excluded. */
export function selectableAgents(agents: readonly AgentInfo[]) {
  return agents.filter((agent) => agent.mode !== "subagent" && !agent.hidden).map((agent) => agent.id)
}

export interface ModelInfo {
  id: string
  modelID: string
  providerID: string
  family?: string
  enabled: boolean
  status: string
  variants: readonly { id: string }[]
  time: { released: number }
}

export interface ModelRef {
  id: string
  providerID: string
  variant?: string
}

export function formatModel(model: ModelRef | undefined) {
  if (!model) return "default"
  return `${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ""}`
}

/** Newest plain (non -fast) model of each family, keyed by its short name: opus, sonnet, haiku... */
export function modelAliases(models: readonly ModelInfo[]) {
  const aliases = new Map<string, ModelInfo>()
  for (const model of models) {
    if (!model.enabled || model.status === "deprecated" || !model.family || model.id !== model.modelID) continue
    const alias = model.family.replace(/^claude-/, "")
    const current = aliases.get(alias)
    if (!current || model.time.released > current.time.released) aliases.set(alias, model)
  }
  return aliases
}

/** `opus`, `opus#high`, `claude-opus-5-5`, `anthropic/claude-opus-5-5#max`. Returns an error message on failure. */
export function resolveModel(spec: string, models: readonly ModelInfo[]): ModelRef | string {
  const [name, variant] = spec.split("#", 2)
  const enabled = models.filter((model) => model.enabled)
  const slash = name.indexOf("/")
  const model =
    slash > 0
      ? enabled.find((model) => model.providerID === name.slice(0, slash) && model.id === name.slice(slash + 1))
      : (enabled.find((model) => model.id === name) ?? modelAliases(enabled).get(name.toLowerCase()))
  if (!model) return `Unknown model "${name}". Short names: ${[...modelAliases(enabled).keys()].sort().join(", ")}.`
  if (variant && !model.variants.some((v) => v.id === variant)) {
    return `${model.providerID}/${model.id} has no variant "${variant}". Variants: ${model.variants.map((v) => v.id).join(", ")}.`
  }
  return { id: model.id, providerID: model.providerID, ...(variant ? { variant } : {}) }
}

function subdirectories(directory: string) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Directories worth suggesting for `dir=`: the workspace's subdirectories, and the repositories one level further
 * into those that are not repositories themselves (e.g. server/common-infra).
 */
export function workspaceDirs(workspace: string) {
  return subdirectories(workspace).flatMap((name) => {
    const nested = isRepository(join(workspace, name))
      ? []
      : subdirectories(join(workspace, name)).filter((child) => isRepository(join(workspace, name, child)))
    return [name, ...nested.map((child) => `${name}/${child}`)]
  })
}

function isRepository(path: string) {
  return isDirectory(join(path, ".git"))
}

/** Absolute directory for `dir=`, a relative path inside the workspace. Returns an error message on failure. */
export function resolveDir(workspace: string, dir: string | undefined): { directory: string } | string {
  if (!dir || dir === ".") return { directory: workspace }
  const segments = dir.replace(/\/+$/, "").split("/")
  const directory = join(workspace, ...segments)
  const valid = segments.every((segment) => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(segment)) && isDirectory(directory)
  if (!valid) return `Unknown directory "${dir}". Directories: ${workspaceDirs(workspace).join(", ") || "(none)"}.`
  return { directory }
}

function isDirectory(path: string) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export const SESSION_HELP = [
  "Commands in this DM:",
  "  !status: agent, model, directory, usage",
  "  !agent <agent>: switch agent for the next turns",
  "  !model <model>[#variant]: switch model, e.g. !model sonnet or !model opus#max",
  "  !rename <name>: rename the session, its Matrix account and this room",
  "  !stop: interrupt the session",
  "Anything else goes to the session.",
].join("\n")

export function dispatcherHelp(agents: readonly string[], dirs: readonly string[], aliases: Map<string, ModelInfo>) {
  return [
    "Send a message to start a session. Options go first:",
    "  agent=<agent> dir=<directory> model=<model>[#variant] <prompt>",
    "  e.g. agent=plan dir=server/common-infra why is the gatus check flapping?",
    "",
    "Commands:",
    "  !sessions: recent sessions started here",
    "  !default [options | clear]: show, set or clear this room's default options",
    "  !rename <name>: change this dispatcher's display name, e.g. to tell machines apart",
    "  !help",
    "",
    `Agents: ${agents.join(", ")}`,
    `Directories: ${dirs.join(", ") || "(none)"}`,
    `Models: ${[...aliases].map(([alias, model]) => `${alias} (${model.id})`).join(", ")}, or provider/model`,
  ].join("\n")
}
