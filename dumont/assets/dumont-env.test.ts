import { expect, test } from "bun:test"
import { parseKeysFile } from "./dumont-env"

test("reads the shapes llm-keys.env actually uses", () => {
  expect(
    parseKeysFile(
      [
        "# Dumont shared provider keys",
        "",
        "export DEEPSEEK_API_KEY=sk-deepseek",
        "export GEMINI_API_KEY='sk-gemini'",
        'export OPENROUTER_API_KEY="sk-openrouter"',
        "PLAIN_KEY=no-export-prefix",
        "  export SPACED_KEY = sk-spaced  ",
      ].join("\n"),
    ),
  ).toEqual({
    DEEPSEEK_API_KEY: "sk-deepseek",
    GEMINI_API_KEY: "sk-gemini",
    OPENROUTER_API_KEY: "sk-openrouter",
    PLAIN_KEY: "no-export-prefix",
    SPACED_KEY: "sk-spaced",
  })
})

test("ignores what is not an assignment rather than inventing keys", () => {
  expect(
    parseKeysFile(
      [
        "# comment",
        "",
        "   ",
        "not an assignment",
        "=novalueforkey",
        "9BAD_KEY=x", // must start with a letter or underscore
        "BAD-KEY=x", // hyphens are not valid in an env name
        "EMPTY_KEY=",
        'QUOTED_EMPTY=""',
      ].join("\n"),
    ),
  ).toEqual({})
})

test("does not execute the file", () => {
  // The file is read, never sourced. A command substitution is data.
  const env = parseKeysFile("export EVIL=$(rm -rf /tmp/should-not-happen)")
  expect(env.EVIL).toBe("$(rm -rf /tmp/should-not-happen)")
})

test("last assignment wins, like sourcing would", () => {
  expect(parseKeysFile("export K=first\nexport K=second")).toEqual({ K: "second" })
})
