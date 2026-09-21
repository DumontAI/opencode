#!/usr/bin/env bun
/**
 * Check dumont/changelog.json against the REAL parser in
 * packages/app/src/context/highlights.tsx.
 *
 *   bun dumont/tools/check-changelog.ts
 *
 * The parser's pure functions are module-local, so this slices them out of the
 * source and evaluates them rather than restating them here. That matters: a
 * hand-copied duplicate would keep passing after upstream changed the rules, and
 * the whole point is to catch that. If upstream moves the functions this script
 * fails loudly instead of quietly testing nothing.
 *
 * The trap it exists to catch: every highlight group is dropped unless its
 * `source` contains the substring "desktop", case-insensitively. A changelog
 * that looks perfectly reasonable otherwise produces zero highlights, and the
 * dialog then never appears, which is indistinguishable from the feed being
 * down.
 */
import { readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SOURCE = join(ROOT, "packages/app/src/context/highlights.tsx")
const CHANGELOG = join(ROOT, "dumont/changelog.json")

const src = await readFile(SOURCE, "utf8")

const START = "function isRecord("
const END = "export const { use: useHighlights"
const from = src.indexOf(START)
const to = src.indexOf(END)
if (from === -1 || to === -1 || to <= from) {
  console.error(`Could not slice the parser out of ${SOURCE}.`)
  console.error("Upstream moved it. Fix the markers in this script rather than deleting the check.")
  process.exit(1)
}

// Everything between those markers is plain TypeScript with no JSX and no
// imports, so it evaluates standalone.
const body = src.slice(from, to)
for (const name of ["parseChangelog", "loadReleaseHighlights", "sliceHighlights"]) {
  if (!body.includes(`function ${name}(`)) {
    console.error(`Sliced region no longer defines ${name}. Upstream refactored the parser.`)
    process.exit(1)
  }
}

// The slice is TypeScript, so it goes through bun's loader rather than
// `new Function`, which only parses plain JavaScript.
const temp = join(tmpdir(), `dumont-changelog-parser-${randomUUID()}.ts`)
await writeFile(
  temp,
  `type Highlight = { title: string; description: string; media?: unknown }\n` +
    `${body}\nexport { parseChangelog, loadReleaseHighlights }\n`,
)
const parser = (await import(temp)) as {
  parseChangelog: (v: unknown) => { tag?: string; highlights: unknown[] }[] | undefined
  loadReleaseHighlights: (v: unknown, current?: string, previous?: string) => { title: string }[]
}
await rm(temp, { force: true })
const { parseChangelog, loadReleaseHighlights } = parser

const json = JSON.parse(await readFile(CHANGELOG, "utf8"))
const version = JSON.parse(await readFile(join(ROOT, "packages/desktop/package.json"), "utf8")).version

const problems: string[] = []

const releases = parseChangelog(json)
if (!releases?.length) problems.push("parseChangelog returned nothing: the top level must be an array or { releases: [...] }")

const tags = (releases ?? []).map((r) => r.tag)
if (!tags.includes(version)) {
  problems.push(
    `no release is tagged "${version}" (found ${JSON.stringify(tags)}). ` +
      "sliceHighlights starts at the running version, so a mismatched tag shows the wrong notes or none.",
  )
}

// previous undefined is the first-run case: everything from the current version on.
const firstRun = loadReleaseHighlights(json, version, undefined)
if (!firstRun.length) {
  problems.push(
    'zero highlights on a first run. The usual cause is a group whose "source" does not contain "desktop", ' +
      "or an item missing a non-empty title or description. Both are dropped silently.",
  )
}

if (problems.length) {
  console.error(`changelog.json is not valid for this app:\n`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log(`changelog.json OK for ${version}`)
console.log(`  releases parsed : ${releases!.length} (${tags.join(", ")})`)
console.log(`  first-run shows : ${firstRun.length} highlight(s), capped at 5 by sliceHighlights`)
for (const h of firstRun) console.log(`    - ${h.title}`)
