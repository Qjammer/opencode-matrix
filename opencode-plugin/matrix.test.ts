import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readAsToken } from "./matrix.ts"

const dir = mkdtempSync(join(tmpdir(), "as-token-"))
function file(name: string, text: string) {
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}

test("the token comes from an appservice registration, in YAML or JSON", () => {
  expect(readAsToken(file("registration.yaml", "id: sessions\nas_token: abc123\nhs_token: def456\n"))).toBe("abc123")
  expect(readAsToken(file("quoted.yaml", '"as_token": "abc123"\n"hs_token": "def456"\n'))).toBe("abc123")
  expect(readAsToken(file("single-quoted.yaml", "as_token: 'abc123'\nhs_token: 'def456'\n"))).toBe("abc123")
  expect(readAsToken(file("one-line.json", '{"as_token":"abc123","hs_token":"def456"}'))).toBe("abc123")
  expect(readAsToken(file("pretty.json", '{\n  "as_token": "abc123",\n  "hs_token": "def456"\n}\n'))).toBe("abc123")
})

test("a file holding only the token is the token", () => {
  expect(readAsToken(file("token", "abc123\n"))).toBe("abc123")
})

test("anything else is refused", () => {
  expect(() => readAsToken(file("empty", ""))).toThrow("neither")
  expect(() => readAsToken(file("prose", "not a token\n"))).toThrow("neither")
  expect(() => readAsToken(file("no-token.json", '{"hs_token":"def456"}'))).toThrow("neither")
  expect(() => readAsToken(file("broken.json", '{"as_token":'))).toThrow("neither")
  expect(() => readAsToken(file("other.yaml", "id:sessions"))).toThrow("neither")
})
