#!/usr/bin/env bun
/**
 * Merge per-arch latest-mac.yml files into the one feed electron-updater reads.
 *
 *   bun dumont/tools/merge-latest-mac.ts dist/latest-mac.arm64.yml dist/latest-mac.x64.yml
 *
 * Each arch has to be built in its own electron-vite run (see build-mac.sh), and
 * electron-builder writes a fresh latest-mac.yml each time describing only that
 * run. Publishing one of them means the other arch never sees an update, so the
 * two file lists are combined here.
 *
 * MacUpdater picks an entry by looking for "arm64" in the file URL, preferring
 * arm64 on Apple silicon and excluding it on Intel, so the order within `files`
 * does not matter. The trailing `path`/`sha512` are a legacy fallback for old
 * clients; they point at the x64 zip, which is the safe choice because it runs
 * everywhere under Rosetta.
 */
import { readFile, writeFile } from "node:fs/promises"

const inputs = process.argv.slice(2)
if (inputs.length < 2) {
  console.error("usage: merge-latest-mac.ts <yml> <yml> [...]  (output goes to dist/latest-mac.yml)")
  process.exit(2)
}

type Entry = { url: string; sha512: string; size: number }

function parse(text: string) {
  const version = text.match(/^version:\s*(.+)$/m)?.[1]?.trim()
  const releaseDate = text.match(/^releaseDate:\s*(.+)$/m)?.[1]?.trim()
  const entries: Entry[] = []
  const re = /-\s+url:\s*(\S+)\s*\n\s+sha512:\s*(\S+)\s*\n\s+size:\s*(\d+)/g
  for (const m of text.matchAll(re)) entries.push({ url: m[1], sha512: m[2], size: Number(m[3]) })
  if (!version) throw new Error("no version field")
  if (!entries.length) throw new Error("no file entries")
  return { version, releaseDate, entries }
}

const parsed = await Promise.all(
  inputs.map(async (f) => {
    try {
      return { file: f, ...parse(await readFile(f, "utf8")) }
    } catch (error) {
      console.error(`${f}: ${(error as Error).message}`)
      process.exit(1)
    }
  }),
)

const versions = [...new Set(parsed.map((p) => p.version))]
if (versions.length !== 1) {
  console.error(`version mismatch between inputs: ${versions.join(", ")}. Rebuild both from the same tree.`)
  process.exit(1)
}

const seen = new Set<string>()
const files: Entry[] = []
for (const p of parsed) {
  for (const e of p.entries) {
    if (seen.has(e.url)) continue
    seen.add(e.url)
    files.push(e)
  }
}

for (const arch of ["arm64", "x64"]) {
  if (!files.some((f) => f.url.includes(arch) && f.url.endsWith(".zip"))) {
    console.error(`merged feed has no ${arch} zip. electron-updater needs the ZIP, not the DMG.`)
    process.exit(1)
  }
}

const fallback = files.find((f) => f.url.includes("x64") && f.url.endsWith(".zip"))!
const out =
  `version: ${versions[0]}\n` +
  `files:\n` +
  files.map((f) => `  - url: ${f.url}\n    sha512: ${f.sha512}\n    size: ${f.size}\n`).join("") +
  `path: ${fallback.url}\n` +
  `sha512: ${fallback.sha512}\n` +
  `releaseDate: '${parsed[0].releaseDate?.replace(/^'|'$/g, "") ?? new Date().toISOString()}'\n`

const target = inputs[0].replace(/latest-mac\..*\.yml$/, "latest-mac.yml")
await writeFile(target, out)
console.log(`merged ${inputs.length} feeds -> ${target}`)
for (const f of files) console.log(`  ${f.url}`)
