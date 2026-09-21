# Dumont Code Desktop

Dumont's fork of [opencode](https://github.com/sst/opencode) (MIT), rebranded as
**Dumont Code** and distributed as a signed, notarised macOS DMG from Dumont's
own domain.

Only `packages/desktop` and the bits of `packages/ui` / `packages/app` it
renders are rebranded. The CLI wrap lives in a separate repo
(`DumontAI/dumont-code`) and is not touched by anything here.

| | |
|---|---|
| Fork | `DumontAI/opencode` (`origin`), upstream `sst/opencode` |
| Branches | `dev` tracks upstream untouched. **All customisation lives on `dumont`.** Changes flow upstream to `dumont` only, never back. |
| Product name | Dumont Code |
| Bundle id | `ai.dumont.code` (`.dev`, `.beta`) |
| Protocol schemes | `dumontcode://` **and** `opencode://` |
| Artefact | `dumont-code-desktop-${os}-${arch}.${ext}` |
| Update feed | `https://dumont.au/desktop/code/<channel>` |
| Signing identity | `Developer ID Application: Dumont Pty Ltd (5VQ28Z7532)` |

## The trap

Upstream ships this in `packages/desktop/electron-builder.config.ts`:

```ts
publish: { provider: "github", owner: "anomalyco", repo: "opencode", channel: "latest" }
```

electron-builder writes that into `app-update.yml` inside the app bundle, and
`electron-updater` follows it at runtime. Ship it unchanged and the first user
who accepts an update prompt installs **stock opencode**, silently reverting the
entire rebrand. That is not hypothetical: it is exactly what happened to Dumont
Chat desktop via `updateNotificationURL`.

Every channel now uses `provider: "generic"` under `https://dumont.au/desktop/code`.
`electron-builder.config.test.ts` asserts it and fails if any `opencode.ai`,
`anomalyco` or `sst/opencode` string reappears in the resolved config. Verify the
built output too, not just the source:

```bash
grep -ri "opencode\.ai\|anomalyco\|sst/opencode\|releases\.opencode" \
  "packages/desktop/dist/mac-arm64/Dumont Code.app/Contents/Resources/app-update.yml"
```

`opencode://` stays registered alongside `dumontcode://` on purpose. The bundled
server and CLI still emit `opencode://` deep links; dropping the scheme breaks
them. Same lesson as `allowedProtocols` on Dumont Chat.

## Build

```bash
bun install            # repo root, bun workspace
./dumont/build-mac.sh  # prebuild + bundles + package + sign + notarise (arm64)
```

Output lands in `packages/desktop/dist/`:

- `dumont-code-desktop-mac-arm64.dmg` (what users download)
- `dumont-code-desktop-mac-arm64.zip` + `latest-mac.yml` (what the updater reads)

Requires node >= 22 and `bun`. The repo is a bun workspace; npm and yarn will not
resolve `workspace:*`. Install bun with `curl -fsSL https://bun.sh/install | bash`.

`bun run prebuild` also builds the opencode CLI node bundle out of
`packages/opencode`, so a desktop build is never just the Electron part.

## Branding

`dumont/apply-branding.ts` is the **single source of truth**. The committed state
of this branch is its output. Never hand-edit a branded file: fix the script.

```bash
bun dumont/apply-branding.ts           # apply
bun dumont/apply-branding.ts --check   # exit 1 if anything is unbranded
```

Every replacement must match its upstream text exactly once. When upstream
renames something the script **fails** with the file and the snippet it could not
find. That is deliberate. A silent skip would ship a half-branded build, and the
worst case of a half-branded build is the updater trap above.

Assets it installs:

- `dumont/theme/dumont.json` -> `packages/ui/src/theme/themes/dumont.json`, wired
  as the default theme id in `packages/ui/src/theme/context.tsx`. Desktop themes
  are bundled at build time through `import.meta.glob("./themes/*.json")`; there
  is no runtime custom-theme loading, so a theme has to be a file in that
  directory. This is a different schema from the TUI themes in
  `DumontAI/dumont-code`, which will not work here.
- `dumont/assets/logo.tsx` -> `packages/ui/src/components/logo.tsx`. The winged D
  renders in Dumont teal in both schemes so it matches the dock icon; the DUMONT
  wordmark follows `--icon-strong-base` so it is navy on light and light on dark.
  The square mark is used for `Mark` and `Splash`, the full lockup only for
  `Logo`, which is the low-opacity watermark on the home and error pages. Do not
  put the lockup in a small slot: the wordmark goes illegible.
- `dumont/assets/icons/` -> `packages/desktop/icons/{dev,beta,prod}/`. Rebuild
  with `./dumont/tools/build-icons.sh` only when the brand art changes; the
  output is committed so applying branding stays fast.

## Bump against upstream

```bash
git fetch upstream
git checkout dev && git merge --ff-only upstream/dev && git push origin dev
git checkout dumont && git merge dev
```

For any conflict in a file the branding script owns, take the upstream side and
let the script re-apply:

```bash
git checkout --theirs <file>   # "theirs" during a merge is the incoming upstream side
bun dumont/apply-branding.ts
bun dumont/apply-branding.ts --check
(cd packages/desktop && bun test electron-builder.config.test.ts)
git add -A && git commit
```

Files the script does **not** own (`dumont/**` itself) are ours outright.

Upstream moves fast: 1.18.16 to 1.18.31 in a few weeks. Expect the script to fail
on a rename occasionally; that failure is the feature.

## Sign and notarise

Already wired into `dumont/build-mac.sh`. The traps, each of which stops the
build dead with an error that does not point at the fix:

1. `CSC_NAME` must **not** include the `Developer ID Application:` prefix. Use
   `Dumont Pty Ltd (5VQ28Z7532)`.
2. The identity lives in a dedicated keychain, `dumont-signing.keychain`, not the
   login keychain, so no interactive password prompt is needed.
3. macOS does not ship the G2 intermediate. If `security find-identity -v` does
   not list the identity as valid, import
   `https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer`.
4. Do **not** build a release with `NO_CODESIGN=1` or
   `CSC_IDENTITY_AUTO_DISCOVERY=false`. That path strips `hardenedRuntime` and
   the entitlements, and notarisation rejects it.
5. Never `pkill -f "Dumont Code"` while notarising: it matches the `notarytool`
   process by its file argument and kills the submission.
6. Do not inspect `dist/` while a build is running. electron-builder deletes and
   recreates the bundle mid-run, and a `codesign` reading taken then reports
   `adhoc, linker-signed`.

### Verifying

`spctl` against the **DMG** reports `rejected: no usable signature`. That is
normal: electron-builder signs the app, not the disk image. Test the path a user
actually takes.

```bash
hdiutil attach "packages/desktop/dist/dumont-code-desktop-mac-arm64.dmg"
spctl -a -t exec -vv "/Volumes/Dumont Code 1.18.31/Dumont Code.app"
hdiutil detach "/Volumes/Dumont Code 1.18.31"
```

Expect `accepted` / `source=Notarized Developer ID`. Likewise `stapler validate`
on the `.app` says no ticket, because the ticket is stapled to the DMG.

**Signing verification is not launch verification.** On Dumont Chat a build
passed `codesign --verify --deep --strict`, notarisation and `spctl` and still
could not start, because of a restricted entitlement. The release check is:
download the published DMG, stamp it with a quarantine attribute, mount it, copy
the app out, run the binary and confirm the process is alive fifteen seconds
later.

## Distribution

Mirrors the Dumont Chat precedent: downloads are served from Dumont's own domain,
not GitHub. On hel1 (`airbase-hel1`, 77.42.6.34), under
`/opt/dumont-website/desktop/code/`:

```
prod/dumont-code-desktop-mac-arm64.dmg
prod/dumont-code-desktop-mac-arm64.zip
prod/latest-mac.yml            <- the electron-updater feed
DumontCode-latest-arm64.dmg    <- stable human-facing symlink
```

`latest-mac.yml` is the updater's feed and is generated by electron-builder next
to the artefacts. It references the `.zip`, not the `.dmg`, so **both must be
published** or the updater downloads a 404. Curl the exact URL the app
constructs, not just the human-facing link: a broken download URL is silent until
someone acts on an update prompt.

## Not done

- Windows and Linux. The config is rebranded for both and `icon.ico` plus the
  Linux hicolor set are generated, but neither has been built or tested. Windows
  additionally needs the `sign-windows.ps1` path, which is GitHub-Actions-only
  upstream.
- Publishing to the App Store. Deliberately not pursued: it forces sandboxing and
  per-release review for no benefit on a DMG served from dumont.au.
