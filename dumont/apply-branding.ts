#!/usr/bin/env bun
/**
 * Dumont Code desktop branding.
 *
 * This script is the single source of truth for every Dumont-specific change in
 * the fork. The committed state of the `dumont` branch is just its output, so
 * after merging upstream you can always reset a conflicted branded file to the
 * upstream version and re-run this.
 *
 *   bun dumont/apply-branding.ts            # apply, fail loudly on drift
 *   bun dumont/apply-branding.ts --check    # report only, exit 1 if not applied
 *
 * Every replacement below must match its upstream text exactly once. When
 * upstream renames or moves something the script fails with the file and the
 * snippet it could not find, which is deliberate: a silent skip would ship a
 * half-branded build, and the worst case of that is an updater feed still
 * pointing at opencode (see dumont/README.md, "The trap").
 */
import { $ } from "bun"
import { existsSync } from "node:fs"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const DUMONT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(DUMONT_DIR, "..")
const CHECK = process.argv.includes("--check")

/** Where the shipped app looks for its update feed. Never an sst/opencode host. */
export const UPDATE_FEED_BASE = "https://dumont.au/desktop/code"

const PRODUCT = {
  prod: { name: "Dumont Code", appId: "ai.dumont.code" },
  beta: { name: "Dumont Code Beta", appId: "ai.dumont.code.beta" },
  dev: { name: "Dumont Code Dev", appId: "ai.dumont.code.dev" },
} as const

type Edit = [from: string, to: string]

const problems: string[] = []
const applied: string[] = []

function note(kind: "ok" | "skip" | "fail", message: string) {
  if (kind === "fail") problems.push(message)
  else applied.push(`${kind === "ok" ? "changed" : "already"}  ${message}`)
}

async function patch(relative: string, edits: Edit[]) {
  const file = join(ROOT, relative)
  if (!existsSync(file)) {
    note("fail", `${relative}: file does not exist (moved upstream?)`)
    return
  }
  let text = await readFile(file, "utf8")
  const before = text
  for (const [from, to] of edits) {
    // Test the result first. Some edits insert around their anchor, so `from`
    // survives the edit and a hits-first check would re-apply it every run.
    if (text.includes(to)) continue
    const hits = text.split(from).length - 1
    if (hits === 1) {
      text = text.replace(from, to)
      continue
    }
    if (hits > 1) {
      note("fail", `${relative}: snippet matched ${hits} times, expected 1:\n      ${from.split("\n")[0]}`)
      continue
    }
    if (text.includes(to)) continue // already applied
    note("fail", `${relative}: could not find:\n      ${from.split("\n")[0]}`)
  }
  if (text === before) {
    note("skip", relative)
    return
  }
  if (!CHECK) await writeFile(file, text)
  note("ok", relative)
}

/**
 * Replace a whole block matched by a regex, for the cases where the upstream text
 * is too long to embed literally. Same contract as `patch`: exactly one match, or
 * it fails loudly.
 */
async function patchBlock(relative: string, pattern: RegExp, replacement: string) {
  const file = join(ROOT, relative)
  if (!existsSync(file)) {
    note("fail", `${relative}: file does not exist (moved upstream?)`)
    return
  }
  const text = await readFile(file, "utf8")
  if (text.includes(replacement.trimEnd())) {
    note("skip", relative)
    return
  }
  const matches = text.match(pattern)
  if (!matches) {
    note("fail", `${relative}: block not found for ${pattern}`)
    return
  }
  if (matches.length > 1) {
    note("fail", `${relative}: block matched ${matches.length} times, expected 1`)
    return
  }
  if (!CHECK) await writeFile(file, text.replace(pattern, () => replacement))
  note("ok", relative)
}

async function copyInto(source: string, relative: string) {
  const target = join(ROOT, relative)
  const from = join(DUMONT_DIR, source)
  const next = await readFile(from, "utf8").catch(() => null)
  if (next !== null) {
    const current = await readFile(target, "utf8").catch(() => null)
    if (current === next) {
      note("skip", relative)
      return
    }
  }
  if (!CHECK) {
    await mkdir(dirname(target), { recursive: true })
    await cp(from, target, { recursive: true })
  }
  note("ok", relative)
}

// ---------------------------------------------------------------------------
// 1. Update feed and packaging identity. Highest-risk file in the fork.
// ---------------------------------------------------------------------------
const publishLine = (channel: keyof typeof PRODUCT) =>
  `publish: { provider: "generic", url: "${UPDATE_FEED_BASE}/${channel}", channel: "latest" }`

await patch("packages/desktop/electron-builder.config.ts", [
  [
    `// The Electron 42 packaging update briefly installed Linux launchers/icons under
// "opencode-desktop". Keep that hidden desktop entry around so existing GNOME/KDE
// pins still resolve after the canonical app id changes back to ai.opencode.desktop.
const legacyDesktopEntry = path.join(packageDir, "resources", "linux", "opencode-desktop.desktop")
const legacyDesktopEntryFpm = \`\${legacyDesktopEntry}=/usr/share/applications/opencode-desktop.desktop\`
`,
    `// Upstream keeps a hidden legacy Linux launcher so old GNOME/KDE pins still
// resolve. Dumont Code has never shipped under another Linux id, so there is
// nothing to preserve and the entry is dropped along with its opencode name.
`,
  ],
  [
    `const APP_IDS = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
} as const`,
    `const APP_IDS = {
  dev: "${PRODUCT.dev.appId}",
  beta: "${PRODUCT.beta.appId}",
  prod: "${PRODUCT.prod.appId}",
} as const`,
  ],
  [
    `  artifactName: "opencode-desktop-\${os}-\${arch}.\${ext}",`,
    `  artifactName: "dumont-code-desktop-\${os}-\${arch}.\${ext}",`,
  ],
  [
    `  extraMetadata: {
    desktopName: \`\${appId}.desktop\`,
  },`,
    `  extraMetadata: {
    desktopName: \`\${appId}.desktop\`,
    // electron-builder derives updaterCacheDirName from the package name, so
    // without this the shipped app-update.yml reads "@opencode-aidesktop-updater".
    // It is only a local cache directory, invisible to users, but it is the last
    // opencode string in that file and the file is the one people read to check
    // the updater. Nothing reads package.json name at runtime: the app sets its
    // name and userData path explicitly from APP_NAMES/APP_IDS.
    name: "dumont-code-desktop",
  },`,
  ],
  [
    `  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "ai.opencode.desktop" becomes
  // "ai.opencode.desktop.desktop".`,
    `  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "${PRODUCT.prod.appId}" becomes
  // "${PRODUCT.prod.appId}.desktop".`,
  ],
  [
    `  protocols: {
    name: "OpenCode",
    schemes: ["opencode"],
  },`,
    `  // "opencode" stays registered next to "dumontcode": the bundled server and
  // CLI still emit opencode:// deep links, and dropping the scheme breaks them.
  protocols: {
    name: "${PRODUCT.prod.name}",
    schemes: ["dumontcode", "opencode"],
  },`,
  ],
  [
    `        appId,
        productName: "OpenCode Dev",
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "opencode-dev", fpm: [metainfoFpm(appId)] },`,
    `        appId,
        productName: "${PRODUCT.dev.name}",
        ${publishLine("dev")},
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "dumont-code-dev", fpm: [metainfoFpm(appId)] },`,
  ],
  [
    `        appId,
        productName: "OpenCode Beta",
        protocols: { name: "OpenCode Beta", schemes: ["opencode"] },
        publish: { provider: "github", owner: "anomalyco", repo: "opencode-beta", channel: "latest" },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "opencode-beta", fpm: [metainfoFpm(appId)] },`,
    `        appId,
        productName: "${PRODUCT.beta.name}",
        protocols: { name: "${PRODUCT.beta.name}", schemes: ["dumontcode", "opencode"] },
        ${publishLine("beta")},
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "dumont-code-beta", fpm: [metainfoFpm(appId)] },`,
  ],
  [
    `        appId,
        productName: "OpenCode",
        protocols: { name: "OpenCode", schemes: ["opencode"] },
        publish: { provider: "github", owner: "anomalyco", repo: "opencode", channel: "latest" },
        deb: { fpm: [metainfoFpm(appId), legacyDesktopEntryFpm] },
        rpm: { packageName: "opencode", fpm: [metainfoFpm(appId), legacyDesktopEntryFpm] },`,
    `        appId,
        productName: "${PRODUCT.prod.name}",
        protocols: { name: "${PRODUCT.prod.name}", schemes: ["dumontcode", "opencode"] },
        ${publishLine("prod")},
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "dumont-code", fpm: [metainfoFpm(appId)] },`,
  ],
])

await patch("packages/desktop/electron-builder.config.test.ts", [
  [
    `const legacyDesktopEntry = "resources/linux/opencode-desktop.desktop"

const channels = [
  { channel: "dev", appId: "ai.opencode.desktop.dev" },
  { channel: "beta", appId: "ai.opencode.desktop.beta" },
  { channel: "prod", appId: "ai.opencode.desktop" },
] as const`,
    `const channels = [
  { channel: "dev", appId: "${PRODUCT.dev.appId}" },
  { channel: "beta", appId: "${PRODUCT.beta.appId}" },
  { channel: "prod", appId: "${PRODUCT.prod.appId}" },
] as const

const FEED_BASE = "${UPDATE_FEED_BASE}"`,
  ],
  [
    `test("keeps a hidden prod launcher for old Linux pins", async () => {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = "prod"

  const module = await import("./electron-builder.config.ts?compat=prod")
  const config = module.default as Configuration

  if (previous === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previous

  expect(
    config.deb?.fpm?.some((entry) =>
      entry.endsWith("opencode-desktop.desktop=/usr/share/applications/opencode-desktop.desktop"),
    ),
  ).toBe(true)
  expect(
    config.rpm?.fpm?.some((entry) =>
      entry.endsWith("opencode-desktop.desktop=/usr/share/applications/opencode-desktop.desktop"),
    ),
  ).toBe(true)

  const desktop = await Bun.file(legacyDesktopEntry).text()
  expect(desktop).toContain("Exec=/opt/OpenCode/ai.opencode.desktop %U")
  expect(desktop).toContain("Icon=ai.opencode.desktop")
  expect(desktop).toContain("StartupWMClass=ai.opencode.desktop")
  expect(desktop).toContain("NoDisplay=true")
})`,
    `// The single check that keeps the Dumont Chat desktop failure from repeating:
// a shipped build whose updater feed still resolves to an upstream host silently
// replaces the whole rebrand the first time a user accepts an update prompt.
for (const channel of ["dev", "beta", "prod"] as const) {
  test(\`points the \${channel} updater feed at Dumont\`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel

    const module = await import(\`./electron-builder.config.ts?feed=\${channel}\`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous

    const publish = config.publish as { provider?: string; url?: string; owner?: string } | undefined
    expect(publish?.provider).toBe("generic")
    expect(publish?.url).toBe(\`\${FEED_BASE}/\${channel}\`)
    expect(publish?.owner).toBeUndefined()
    expect(JSON.stringify(config)).not.toMatch(/opencode\\.ai|anomalyco|sst\\/opencode/)
  })
}

test("registers the upstream scheme alongside the Dumont one", async () => {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = "prod"
  const module = await import("./electron-builder.config.ts?protocols=prod")
  const config = module.default as Configuration
  if (previous === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previous

  const protocols = config.protocols as { name?: string; schemes?: string[] }
  expect(protocols.name).toBe("${PRODUCT.prod.name}")
  expect(protocols.schemes).toEqual(["dumontcode", "opencode"])
})`,
  ],
])

// ---------------------------------------------------------------------------
// 2. Main process: names, ids, protocol registration.
// ---------------------------------------------------------------------------
await patch("packages/desktop/src/main/index.ts", [
  [
    `const APP_NAMES: Record<string, string> = {
  dev: "OpenCode Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
}
const APP_IDS: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}`,
    `const APP_NAMES: Record<string, string> = {
  dev: "${PRODUCT.dev.name}",
  beta: "${PRODUCT.beta.name}",
  prod: "${PRODUCT.prod.name}",
}
const APP_IDS: Record<string, string> = {
  dev: "${PRODUCT.dev.appId}",
  beta: "${PRODUCT.beta.appId}",
  prod: "${PRODUCT.prod.appId}",
}
// Both schemes are registered: opencode:// because the bundled server and CLI
// still emit it, dumontcode:// as the Dumont-owned scheme going forward.
const PROTOCOL_SCHEMES = ["dumontcode", "opencode"] as const
const isDeepLink = (value: string) => PROTOCOL_SCHEMES.some((scheme) => value.startsWith(\`\${scheme}://\`))`,
  ],
  [
    `  const appId = app.isPackaged ? APP_IDS[CHANNEL] : "ai.opencode.desktop.dev"`,
    `  const appId = app.isPackaged ? APP_IDS[CHANNEL] : "${PRODUCT.dev.appId}"`,
  ],
  [
    `    const root = join(tmpdir(), \`opencode-onboarding-\${randomUUID()}\`)`,
    `    const root = join(tmpdir(), \`dumont-code-onboarding-\${randomUUID()}\`)`,
  ],
  [
    `  app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "OpenCode Dev")`,
    `  app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "${PRODUCT.dev.name}")`,
  ],
  [
    `    const urls = argv.filter((arg: string) => arg.startsWith("opencode://"))`,
    `    const urls = argv.filter((arg: string) => isDeepLink(arg))`,
  ],
  [
    `  app.setAsDefaultProtocolClient("opencode")`,
    `  for (const scheme of PROTOCOL_SCHEMES) app.setAsDefaultProtocolClient(scheme)`,
  ],
])

await patch("packages/desktop/src/main/windows.ts", [[`    title: "OpenCode",`, `    title: "${PRODUCT.prod.name}",`]])

// ---------------------------------------------------------------------------
// The Dumont layer. Branding without this is a skin: no team config, memory,
// permissions or skills, and no provider keys, because a Finder-launched app has
// no shell. See dumont/assets/dumont-env.ts.
// ---------------------------------------------------------------------------
await copyInto("assets/dumont-env.ts", "packages/desktop/src/main/dumont-env.ts")
await copyInto("assets/dumont-env.test.ts", "packages/desktop/src/main/dumont-env.test.ts")

await patch("packages/desktop/src/main/server.ts", [
  [
    `import { getUserShell, loadShellEnv } from "./shell-env"`,
    `import { dumontEnv } from "./dumont-env"
import { getUserShell, loadShellEnv } from "./shell-env"`,
  ],
  [
    `  Object.assign(process.env, {
    ...shellEnv,
    OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",`,
    `  Object.assign(process.env, {
    ...shellEnv,
    // After shellEnv so the team's keys file wins over a drifted shell profile,
    // which is what bin/dumont-code does by sourcing it before exec.
    ...dumontEnv(getLogger()),
    OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",`,
  ],
])

// The model picker already groups by provider, so the two "deepseek-v4-flash"
// entries do sit under different headings. The composer button does not: it shows
// the bare model name, which is where the two became indistinguishable.
//
// Zen is the only provider worth calling out there, and not as a special case:
// it is a router, so every model name it offers collides with the direct
// provider's name. Labelling every provider would add noise without adding
// information.
await patch("packages/app/src/components/prompt-input-v2.tsx", [
  [
    `            modelName={props.controller.model.selection.current()?.name ?? language.t("dialog.model.select.title")}`,
    `            modelName={
              ((selected) =>
                selected?.name
                  ? selected.provider?.id === "opencode"
                    ? \`Zen \${selected.name}\`
                    : selected.name
                  : language.t("dialog.model.select.title"))(props.controller.model.selection.current())
            }`,
  ],
])

// The bug Carlos hit on the published build: with no model in config, the app
// walks the connected providers in whatever order the server returns them and
// takes the first model of the first one. That was "opencode", which is OpenCode
// Zen, sst's own paid gateway. It is always listed, nobody has funded it, so the
// first message came back `api_error: Unauthorized` after a long hang.
//
// Zen is not removed, just moved to the back: pick it only when it is the only
// thing connected. No model is hardcoded, which keeps the deliberate "the model
// is a runtime choice" stance of the CLI config. Upstream already treats Zen as
// a special case in useProviders().paid() for the same reason.
await patch("packages/app/src/context/local.tsx", [
  [
    `    const defaultModel = () => {
      const defaults = providers.default()
      for (const provider of providers.connected()) {`,
    `    const defaultModel = () => {
      const defaults = providers.default()
      const candidates = [...providers.connected()]
      const usable = candidates.filter((provider) => provider.id !== ZEN_PROVIDER_ID)
      for (const provider of usable.length > 0 ? usable : candidates) {`,
  ],
  [
    `export const { use: useLocal, provider: LocalProvider } = createSimpleContext({`,
    `// OpenCode Zen. A routed gateway that is always advertised and needs its own
// funding, so it must never be the automatic first choice.
const ZEN_PROVIDER_ID = "opencode"

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({`,
  ],
])

// Cross-arch builds. Upstream's "opencode:node-pty-narrower" plugin rewrites
// `@lydell/node-pty` to the concrete `@lydell/node-pty-<platform>-<arch>` package
// using the BUILD MACHINE's process.arch, which bakes the host arch into the
// bundle. electron-vite runs once while electron-builder packages both arches
// from that single bundle, so an x64 app built on Apple silicon ships a bundle
// that imports node-pty-darwin-arm64 and dies on launch with
// "Cannot find module './prebuilds/darwin-x64/pty.node'".
//
// Upstream never hits this because their CI builds each arch on its own runner.
// We build both here, so the target arch has to be selectable.
await patch("packages/desktop/electron.vite.config.ts", [
  [
    `const nodePtyPkg = \`@lydell/node-pty-\${process.platform}-\${process.arch}\``,
    `const targetArch = process.env.DUMONT_TARGET_ARCH ?? process.arch
const nodePtyPkg = \`@lydell/node-pty-\${process.platform}-\${targetArch}\``,
  ],
])

// ---------------------------------------------------------------------------
// 3. Renderer: window title, notification icon, updater copy.
// ---------------------------------------------------------------------------
await patch("packages/desktop/src/renderer/index.html", [
  [`    <title>OpenCode</title>`, `    <title>${PRODUCT.prod.name}</title>`],
  [`    <meta name="theme-color" content="#F8F7F7" />`, `    <meta name="theme-color" content="#17355a" />`],
])

await patch("packages/desktop/src/renderer/index.tsx", [
  [`        icon: "https://opencode.ai/favicon-96x96-v3.png",`, `        icon: "./favicon-96x96-v3.png",`],
])

await patch("packages/desktop/src/renderer/i18n/en.ts", [
  [
    `"You are already using the latest version of OpenCode"`,
    `"You are already using the latest version of ${PRODUCT.prod.name}"`,
  ],
  [
    `"Version {{version}} of OpenCode has been downloaded, would you like to install it and relaunch?"`,
    `"Version {{version}} of ${PRODUCT.prod.name} has been downloaded, would you like to install it and relaunch?"`,
  ],
])

// The second release feed, and the one that is easy to miss because it is not
// the updater: highlights.tsx polls opencode's changelog and pops a "what's new"
// dialog. Left alone, a Dumont Code build shows opencode's release notes. The
// Dumont URL 404s today, and the caller already treats a non-ok response as "no
// highlights", so it degrades to silence until we publish one.
await patch("packages/app/src/context/highlights.tsx", [
  [
    `const CHANGELOG_URL = "https://opencode.ai/changelog.json"`,
    `const CHANGELOG_URL = "${UPDATE_FEED_BASE}/changelog.json"`,
  ],
])

await patch("packages/app/src/components/windows-app-menu.tsx", [
  [
    `<DropdownMenu.GroupLabel class="desktop-app-menu-heading">OpenCode</DropdownMenu.GroupLabel>`,
    `<DropdownMenu.GroupLabel class="desktop-app-menu-heading">${PRODUCT.prod.name}</DropdownMenu.GroupLabel>`,
  ],
])

// English UI strings. Rather than 40-odd exact edits that break on every
// upstream copy tweak, this is line-wise, so newly added strings get renamed for
// free. It deliberately does NOT touch:
//   - "OpenCode Zen", which is a real third-party model gateway, not our branding
//   - wsl.* keys, which install and run the actual upstream opencode CLI inside
//     WSL, so calling that "Dumont Code" would be a lie
//   - the handful of keys below that describe upstream rather than this app
// The other 60 locales keep upstream's wording. Carlos uses English; retranslating
// a brand rename across every locale is not worth it and would be machine slop.
const I18N_KEEP_UPSTREAM = [
  "dialog.model.unpaid.freeModels.title", // the free models really are OpenCode Zen's
  "sidebar.gettingStarted.line1", // same
  "error.page.report.prefix", // our fork's bugs are overwhelmingly upstream's
  "settings.desktop.wsl.description", // the opencode server process, by name
]

for (const relative of ["packages/app/src/i18n/en.ts", "packages/app/src/i18n/desktop-native.ts"]) {
  const file = join(ROOT, relative)
  if (!existsSync(file)) {
    note("fail", `${relative}: file does not exist (moved upstream?)`)
    continue
  }
  const before = await readFile(file, "utf8")
  // These files wrap long entries, putting the key on one line and the value on
  // the next. A purely per-line rule therefore misses the value of every wrapped
  // entry: that is how "OpenCode update finished but ..." under
  // desktop.wsl.error.updateVersion got renamed despite the wsl guard, and it
  // only surfaced because wsl/servers.test.ts asserts that exact string.
  // So track the key the current line belongs to.
  let key: string | undefined
  const after = before
    .split("\n")
    .map((line) => {
      const declared = line.match(/^\s*"([^"]+)"\s*:/)
      if (declared) key = declared[1]
      if (!line.includes("OpenCode")) return line
      if (line.includes("OpenCode Zen")) return line
      // wsl.* installs and runs the real upstream opencode CLI inside WSL, so
      // calling that "Dumont Code" would be a lie.
      if (key && /^(desktop\.)?wsl\./.test(key)) return line
      if (key && I18N_KEEP_UPSTREAM.includes(key)) return line
      return line.replaceAll("OpenCode Desktop", "Dumont Code").replaceAll("OpenCode", "Dumont Code")
    })
    .join("\n")
  if (after === before) {
    note("skip", relative)
  } else {
    if (!CHECK) await writeFile(file, after)
    note("ok", relative)
  }
}

await patch("packages/ui/src/components/favicon.tsx", [
  [
    `<Meta name="apple-mobile-web-app-title" content="OpenCode" />`,
    `<Meta name="apple-mobile-web-app-title" content="${PRODUCT.prod.name}" />`,
  ],
])

// ---------------------------------------------------------------------------
// 3b. The OAuth callback page. Every dev sees this on their first provider
// login, in a browser, at the moment they are deciding whether this is a real
// product. It lives in packages/core, so it is compiled into the engine binary
// and the CLI wrap cannot reach it: only this fork can.
//
// The strings appear TWICE: once rendered server-side, and again inside the
// inline <script> that rewrites the card when the callback resolves. Patching
// only the server-side copies leaves the browser showing "OpenCode" the moment
// the page updates itself, which is the half anyone actually reads.
// ---------------------------------------------------------------------------
await patch("packages/core/src/oauth/page.ts", [
  [
    `// The visual language mirrors the OpenCode app: the design tokens are a curated`,
    `// The visual language mirrors the ${PRODUCT.prod.name} app: the design tokens are a curated`,
  ],
  // Server-rendered success and error cards.
  [
    `      message: provider ? \`OpenCode is now connected to \${escapeHtml(provider)}.\` : "OpenCode is now authorized.",`,
    `      message: provider
        ? \`${PRODUCT.prod.name} is now connected to \${escapeHtml(provider)}.\`
        : "${PRODUCT.prod.name} is now authorized.",`,
  ],
  [
    `        ? \`OpenCode couldn't finish connecting to \${escapeHtml(provider)}.\`
        : "OpenCode couldn't complete authorization.",`,
    `        ? \`${PRODUCT.prod.name} couldn't finish connecting to \${escapeHtml(provider)}.\`
        : "${PRODUCT.prod.name} couldn't complete authorization.",`,
  ],
  [
    `      footnote: "Close this window and try again from OpenCode.",`,
    `      footnote: "Close this window and try again from ${PRODUCT.prod.name}.",`,
  ],
  [`    <title>\${escapeHtml(input.title)} · OpenCode</title>`, `    <title>\${escapeHtml(input.title)} · ${PRODUCT.prod.name}</title>`],
  // The same copy again, inside the client-side script.
  [
    `message.textContent=PROVIDER?("OpenCode couldn't finish connecting to "+PROVIDER+"."):"OpenCode couldn't complete authorization.";if(text){detail.textContent=text;detail.hidden=false}footnote.textContent="Close this window and try again from OpenCode."}`,
    `message.textContent=PROVIDER?("${PRODUCT.prod.name} couldn't finish connecting to "+PROVIDER+"."):"${PRODUCT.prod.name} couldn't complete authorization.";if(text){detail.textContent=text;detail.hidden=false}footnote.textContent="Close this window and try again from ${PRODUCT.prod.name}."}`,
  ],
  [
    `message.textContent=PROVIDER?("OpenCode is now connected to "+PROVIDER+"."):"OpenCode is now authorized.";`,
    `message.textContent=PROVIDER?("${PRODUCT.prod.name} is now connected to "+PROVIDER+"."):"${PRODUCT.prod.name} is now authorized.";`,
  ],
])

// Upstream's wordmark is 234x42 and is letters only, so 19px tall gives ~13px
// glyphs. The Dumont lockup is 4:1 and includes the winged D, so at the same
// height the letters come out half that and the brand moment reads as a
// afterthought. 28px matches upstream's optical letter size and overall width.
await patch("packages/core/src/oauth/page.ts", [
  [`  .brand svg { height: 19px; width: auto; }`, `  .brand svg { height: 28px; width: auto; }`],
])

await patchBlock(
  "packages/core/src/oauth/page.ts",
  /\/\/ OpenCode wordmark[\s\S]*?\nconst WORDMARK = `[\s\S]*?`\n/,
  await readFile(join(DUMONT_DIR, "assets/oauth-wordmark.txt"), "utf8"),
)

// ---------------------------------------------------------------------------
// 4. Deep links: accept dumontcode:// as well as opencode://.
// ---------------------------------------------------------------------------
await patch("packages/app/src/pages/layout/deep-links.ts", [
  [
    `const parseUrl = (input: string) => {
  if (!input.startsWith("opencode://")) return`,
    `// Dumont Code registers both schemes; the upstream one has to keep working
// because the bundled server and CLI still emit opencode:// links.
const SCHEMES = ["dumontcode://", "opencode://"]

const parseUrl = (input: string) => {
  if (!SCHEMES.some((scheme) => input.startsWith(scheme))) return`,
  ],
])

// ---------------------------------------------------------------------------
// 5. Theme: ship the Dumont theme and make it the default.
// ---------------------------------------------------------------------------
await copyInto("theme/dumont.json", "packages/ui/src/theme/themes/dumont.json")

await patch("packages/ui/src/theme/context.tsx", [
  [
    `import oc2ThemeJson from "./themes/oc-2.json"`,
    `import oc2ThemeJson from "./themes/oc-2.json"
import dumontThemeJson from "./themes/dumont.json"`,
  ],
  [`  opencode: "OpenCode",`, `  dumont: "Dumont",\n  opencode: "OpenCode",`],
  [
    `const oc2Theme = oc2ThemeJson as DesktopTheme`,
    `const oc2Theme = oc2ThemeJson as DesktopTheme
const dumontTheme = dumontThemeJson as DesktopTheme
// Dumont Code ships its own theme as the default. Anyone who has already picked
// a theme keeps it, because the stored id wins over this fallback.
const DEFAULT_THEME_ID = "dumont"`,
  ],
  [
    `    const themeId = normalize(read(STORAGE_KEYS.THEME_ID) ?? props.defaultTheme) ?? "oc-2"`,
    `    const themeId = normalize(read(STORAGE_KEYS.THEME_ID) ?? props.defaultTheme) ?? DEFAULT_THEME_ID`,
  ],
  [
    `      themes: {
        "oc-2": oc2Theme,
      } as Record<string, DesktopTheme>,`,
    `      themes: {
        "oc-2": oc2Theme,
        dumont: dumontTheme,
      } as Record<string, DesktopTheme>,`,
  ],
  [
    `      const savedTheme = normalize(rawTheme ?? props.defaultTheme) ?? "oc-2"`,
    `      const savedTheme = normalize(rawTheme ?? props.defaultTheme) ?? DEFAULT_THEME_ID`,
  ],
])

// ---------------------------------------------------------------------------
// 6. Logo marks and icons.
// ---------------------------------------------------------------------------
await copyInto("assets/logo.tsx", "packages/ui/src/components/logo.tsx")
// The third logo, and the one that is most visible: the big faded wordmark
// behind the new-session composer. It is not Logo/Mark/Splash, it lives in the
// v2 component set, and the only reason it was caught is that the built app was
// launched and looked at.
await copyInto("assets/wordmark-v2.tsx", "packages/ui/src/v2/components/wordmark-v2.tsx")

// The renderer's index.html links these and the in-app notification icon uses
// favicon-96x96-v3.png, so they ship inside the asar and are user-visible.
for (const favicon of [
  "favicon.ico",
  "favicon-v3.ico",
  "favicon.svg",
  "favicon-v3.svg",
  "favicon-96x96.png",
  "favicon-96x96-v3.png",
  "apple-touch-icon.png",
  "apple-touch-icon-v3.png",
]) {
  await copyInto(`assets/web/${favicon}`, `packages/app/public/${favicon}`)
}

for (const channel of Object.keys(PRODUCT)) {
  const target = join(ROOT, "packages/desktop/icons", channel)
  const source = join(DUMONT_DIR, "assets/icons")
  const stamp = join(target, "icon.icns")
  const same =
    existsSync(stamp) &&
    (await Bun.file(stamp).arrayBuffer()).byteLength ===
      (await Bun.file(join(source, "icon.icns")).arrayBuffer()).byteLength
  if (same) {
    note("skip", `packages/desktop/icons/${channel}`)
    continue
  }
  if (!CHECK) {
    await rm(target, { recursive: true, force: true })
    await cp(source, target, { recursive: true })
  }
  note("ok", `packages/desktop/icons/${channel}`)
}

// ---------------------------------------------------------------------------
// 6b. Version. Dumont ships its own builds off an upstream base, so the version
// carries both: 1.18.32-dumont.1 is a semver prerelease of 1.18.32, which sorts
// above upstream 1.18.31 and so is what electron-updater compares with semver.gt.
//
// UPSTREAM_BASE is deliberately literal. When upstream moves, this edit FAILS,
// which forces whoever merges to pick the next Dumont version rather than
// silently shipping a build whose number says nothing about what is in it.
// ---------------------------------------------------------------------------
const UPSTREAM_BASE = "1.18.31"
export const DUMONT_VERSION = "1.18.32-dumont.1"

await patch("packages/desktop/package.json", [
  [`  "version": "${UPSTREAM_BASE}",`, `  "version": "${DUMONT_VERSION}",`],
])

// ---------------------------------------------------------------------------
// 7. Metadata: package identity and the Linux AppStream blurb.
// ---------------------------------------------------------------------------
await patch("packages/desktop/package.json", [
  [`  "homepage": "https://opencode.ai",`, `  "homepage": "https://dumont.au",`],
  [
    `  "author": {
    "name": "OpenCode",
    "email": "hello@opencode.ai"
  },`,
    `  "author": {
    "name": "Dumont Pty Ltd",
    "email": "hello@dumont.au"
  },`,
  ],
])

await patch("package.json", [
  [
    `  "repository": {
    "type": "git",
    "url": "https://github.com/anomalyco/opencode"
  },`,
    `  "repository": {
    "type": "git",
    "url": "https://github.com/DumontAI/opencode"
  },`,
  ],
])

await patch("packages/desktop/scripts/copy-metainfo.ts", [
  [
    `const appId = channel === "prod" ? "ai.opencode.desktop" : \`ai.opencode.desktop.\${channel}\`
const productName = channel === "prod" ? "OpenCode" : \`OpenCode \${channel.charAt(0).toUpperCase() + channel.slice(1)}\`
const summary = \`Open source AI coding agent\${channel !== "prod" ? \` (\${channel})\` : ""}\``,
    `const appId = channel === "prod" ? "${PRODUCT.prod.appId}" : \`${PRODUCT.prod.appId}.\${channel}\`
const productName =
  channel === "prod" ? "${PRODUCT.prod.name}" : \`${PRODUCT.prod.name} \${channel.charAt(0).toUpperCase() + channel.slice(1)}\`
const summary = \`Dumont's AI coding agent\${channel !== "prod" ? \` (\${channel})\` : ""}\``,
  ],
  [
    `  <developer id="ly.anoma">
    <name>Anomaly Innovations Inc.</name>
  </developer>

  <description>
    <p>
      OpenCode is an open source agent that helps you write and run code with any AI model.
    </p>
  </description>`,
    `  <developer id="au.dumont">
    <name>Dumont Pty Ltd</name>
  </developer>

  <description>
    <p>
      \${productName} is Dumont's build of the open source opencode agent, which helps you
      write and run code with any AI model.
    </p>
  </description>`,
  ],
  [
    `  <url type="bugtracker">https://github.com/anomalyco/opencode/issues</url>
  <url type="homepage">https://opencode.ai</url>
  <url type="vcs-browser">https://github.com/anomalyco/opencode</url>

  <screenshots>
    <screenshot type="default">
      <image>https://raw.githubusercontent.com/anomalyco/opencode/b75d4d1c5ec449585d515c756fc81f080a157a9a/packages/web/src/assets/lander/screenshot.png</image>
    </screenshot>
  </screenshots>`,
    `  <url type="bugtracker">https://github.com/DumontAI/opencode/issues</url>
  <url type="homepage">https://dumont.au</url>
  <url type="vcs-browser">https://github.com/DumontAI/opencode</url>`,
  ],
])

if (!CHECK && existsSync(join(ROOT, "packages/desktop/resources/linux/opencode-desktop.desktop"))) {
  await rm(join(ROOT, "packages/desktop/resources/linux"), { recursive: true, force: true })
  note("ok", "packages/desktop/resources/linux (legacy opencode launcher removed)")
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
for (const line of applied) console.log(`  ${line}`)

if (problems.length) {
  console.error(`\n${problems.length} branding step(s) failed:\n`)
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error("\nUpstream moved something. Fix dumont/apply-branding.ts, do not hand-edit the source.")
  process.exit(1)
}

const changed = applied.filter((line) => line.startsWith("changed")).length
if (CHECK && changed) {
  console.error(`\n${changed} file(s) are missing Dumont branding. Run: bun dumont/apply-branding.ts`)
  process.exit(1)
}
console.log(`\nDumont branding ${CHECK ? "verified" : "applied"}. Update feed: ${UPDATE_FEED_BASE}/<channel>`)
void $
