import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { modelAliases, parseCommand, parseOptions, resolveDir, resolveModel, selectableAgents, workspaceDirs } from "./commands.ts"

const model = (id: string, family: string, released: number, modelID = id) => ({
  id,
  modelID,
  providerID: "anthropic",
  family,
  enabled: true,
  status: "active",
  variants: [{ id: "high" }, { id: "max" }],
  time: { released },
})
const MODELS = [
  model("claude-opus-5", "claude-opus", 1),
  model("claude-opus-5-5", "claude-opus", 2),
  model("claude-opus-5-5-fast", "claude-opus", 3, "claude-opus-5-5"),
  model("claude-sonnet-5-5", "claude-sonnet", 2),
]

test("commands start with !", () => {
  expect(parseCommand("!status")).toEqual({ name: "status", args: "" })
  expect(parseCommand("  !Model opus#high ")).toEqual({ name: "model", args: "opus#high" })
  expect(parseCommand("status")).toBeUndefined()
})

test("options are leading key=value tokens; the prompt starts at the first other word", () => {
  expect(parseOptions("agent=plan dir=common-infra why is x=1?")).toEqual({
    options: { agent: "plan", dir: "common-infra" },
    rest: "why is x=1?",
  })
  expect(parseOptions("x=1 is odd")).toEqual({ options: {}, rest: "x=1 is odd" })
  expect(parseOptions("model=opus\ncheck backups")).toEqual({ options: { model: "opus" }, rest: "check backups" })
})

test("only primary, visible agents are selectable", () => {
  const agents = [
    { id: "build", mode: "primary", hidden: false },
    { id: "explore", mode: "subagent", hidden: false },
    { id: "title", mode: "primary", hidden: true },
    { id: "ops", mode: "all", hidden: false },
  ]
  expect(selectableAgents(agents)).toEqual(["build", "ops"])
})

test("models resolve by short name, ID or provider/ID, with a variant", () => {
  expect([...modelAliases(MODELS).entries()].map(([alias, m]) => [alias, m.id])).toEqual([
    ["opus", "claude-opus-5-5"],
    ["sonnet", "claude-sonnet-5-5"],
  ])
  expect(resolveModel("opus", MODELS)).toEqual({ id: "claude-opus-5-5", providerID: "anthropic" })
  expect(resolveModel("Opus#max", MODELS)).toEqual({ id: "claude-opus-5-5", providerID: "anthropic", variant: "max" })
  expect(resolveModel("claude-opus-5-5-fast", MODELS)).toEqual({ id: "claude-opus-5-5-fast", providerID: "anthropic" })
  expect(resolveModel("anthropic/claude-opus-5#high", MODELS)).toEqual({ id: "claude-opus-5", providerID: "anthropic", variant: "high" })
  expect(resolveModel("gpt", MODELS)).toBe('Unknown model "gpt". Short names: opus, sonnet.')
  expect(resolveModel("opus#ultra", MODELS)).toContain('has no variant "ultra"')
})

test("dir= accepts directories inside the workspace only", () => {
  const workspace = mkdtempSync(join(tmpdir(), "workspace-"))
  mkdirSync(join(workspace, "server/common-infra/ci"), { recursive: true })
  mkdirSync(join(workspace, "server/common-infra/.git"))
  mkdirSync(join(workspace, "scratch/.git"), { recursive: true })
  mkdirSync(join(workspace, "scratch/src"))
  mkdirSync(join(workspace, "notebook/some-task"), { recursive: true })
  mkdirSync(join(workspace, ".hidden"))
  writeFileSync(join(workspace, "notes.md"), "")
  // Repositories are suggested, not their insides, and plain directories only one level deep.
  const dirs = "notebook, scratch, server, server/common-infra"
  expect(workspaceDirs(workspace).join(", ")).toBe(dirs)
  expect(resolveDir(workspace, undefined)).toEqual({ directory: workspace })
  expect(resolveDir(workspace, "server/common-infra/")).toEqual({ directory: join(workspace, "server/common-infra") })
  expect(resolveDir(workspace, "server/common-infra/ci")).toEqual({ directory: join(workspace, "server/common-infra/ci") })
  for (const dir of ["notes.md", "..", "server/../..", "server//common-infra", "./server", "/etc", "missing"]) {
    expect(resolveDir(workspace, dir)).toBe(`Unknown directory "${dir}". Directories: ${dirs}.`)
  }
})
