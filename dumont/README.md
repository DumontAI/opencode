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

### The second feed, which the first pass missed

`packages/app/src/context/highlights.tsx` polls
`https://opencode.ai/changelog.json` and pops a "what's new" dialog. It is not
the updater, so repointing `publish` does nothing for it, and left alone a Dumont
Code build shows opencode's release notes. It now points at
`https://dumont.au/desktop/code/changelog.json`. Nothing is published there yet;
the caller already treats a non-ok response as "no highlights", so it degrades to
silence rather than an error.

It was only found by grepping the **built** app. Grep the build, not the source.

### What is left pointing upstream, and why that is correct

These survive in the shipped `app.asar` and should:

| URL | What it is |
|---|---|
| `opencode.ai/desktop-theme.json` | a JSON Schema `$id` in every theme file. Never fetched. |
| `opencode.ai/docs*`, `/desktop-feedback` | documentation and feedback links. This is opencode; the docs are theirs. |
| `opencode.ai/zen*`, `/go`, `models.opencode.ai` | OpenCode Zen is a real model gateway and models.dev mirror, a product integration and not branding. |
| `opencode.ai/install`, `formulae.brew.sh/.../opencode.json`, `api.github.com/repos/anomalyco/opencode/releases/latest` | the **CLI's** self-upgrade path in `packages/opencode/src/installation`. |

That last row is worth being precise about. The server exposes
`POST /global/upgrade`, which calls `Installation.upgrade`. Nothing in
`packages/app/src` or `packages/desktop/src` calls it, and
`Installation.method()` returns `unknown` for the app's bundled sidecar, so the
route answers 400. If a user does have the opencode CLI installed globally it
would upgrade **that CLI**, not this app: the desktop bundle is replaced only by
electron-updater, which reads `app-update.yml`. Worth re-checking after any
upstream merge that adds an upgrade affordance to the desktop UI.

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

The `.husky/pre-push` hook runs `bun typecheck` across all 30 packages, so
`git push` needs bun on PATH or it fails with `bun: command not found` and a
confusing husky 127. Push with `PATH="$HOME/.bun/bin:$PATH" git push`. The upside
is that a successful push has already typechecked the whole monorepo.

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
2. The identity lives in a dedicated keychain, **`dumont-signing-ci.keychain`**.
   See "If codesign fails with errSecInternalComponent" below; the older
   `dumont-signing.keychain` is locked and its password is not in the Dumont org
   vault.
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

### If codesign fails with errSecInternalComponent

That is not a certificate problem. It means the keychain holding the private key
is locked, or its key has no partition list allowing `codesign` to use it
non-interactively, so `security` tries to raise a GUI prompt that never appears
and the build dies.

`dumont-signing.keychain` hit this on 2026-09-21: it had auto-locked, its
password is in nobody's reach (it is not in the Dumont org vault, so it is in
someone's personal vault), and every `security` call against it hangs.

The identity was rebuilt into a new keychain without needing that password,
because the **certificate is public** and readable out of a locked keychain while
the **private key was already on disk** at `~/.appstore/devid/devid-g2.key`:

```bash
security find-certificate -c "Developer ID Application: Dumont Pty Ltd (5VQ28Z7532)" \
  -p ~/Library/Keychains/dumont-signing.keychain-db > devid-g2.pem

# confirm the key on disk matches that certificate before trusting it
diff <(openssl x509 -in devid-g2.pem -noout -pubkey) \
     <(openssl pkey -in ~/.appstore/devid/devid-g2.key -pubout)

# -legacy -macalg sha1: OpenSSL 3 defaults produce a PKCS#12 macOS cannot read,
# and it reports that as "MAC verification failed ... (wrong password?)"
openssl pkcs12 -export -legacy -macalg sha1 \
  -inkey ~/.appstore/devid/devid-g2.key -in devid-g2.pem \
  -name "Developer ID Application: Dumont Pty Ltd (5VQ28Z7532)" \
  -out devid-g2.p12 -passout "pass:$PW"

security create-keychain -p "$PW" dumont-signing-ci.keychain
security set-keychain-settings dumont-signing-ci.keychain   # no timeout, no lock on sleep
security import devid-g2.p12 -k dumont-signing-ci.keychain -P "$PW" \
  -T /usr/bin/codesign -T /usr/bin/security -T /usr/bin/productsign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PW" dumont-signing-ci.keychain
```

`set-key-partition-list` is the step that actually fixes `errSecInternalComponent`;
importing alone is not enough. `set-keychain-settings` with no flags is what stops
it recurring, because the default is to lock on sleep.

The old keychain was dropped from the search list rather than deleted. Two
certificates sharing a CN make electron-builder resolve a SHA-1 `CSC_NAME` back
to that name and `codesign` then fails as ambiguous.

```bash
security list-keychains -d user   # expect dumont-signing-ci + login, not dumont-signing
```

**The new keychain password is not in the vault.** It is in this session's
scratchpad only. Put it in the Dumont org vault, or regenerate the keychain with
a password of your choosing using the recipe above.

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

## Launch verification

A green build, a passing test suite and a clean grep all said the rebrand was
done while the first screen a user sees still had "opencode" across the middle of
it, in a third logo component nobody had looked for. **Always launch the built
app and look at it.**

This is how, without needing accessibility permissions:

```bash
hdiutil attach packages/desktop/dist/dumont-code-desktop-mac-arm64.dmg -nobrowse
cp -R "/Volumes/Dumont Code 1.18.31-arm64/Dumont Code.app" /tmp/verify/
hdiutil detach "/Volumes/Dumont Code 1.18.31-arm64"

"/tmp/verify/Dumont Code.app/Contents/MacOS/Dumont Code" \
  --remote-debugging-port=9333 --user-data-dir=/tmp/verify-udata &
```

A fresh `--user-data-dir` also avoids the "Dumont Code Safe Storage" keychain
prompt that otherwise blocks the window whenever the signing identity changed.
Then drive it over CDP (`websocket-client` must connect with
`suppress_origin=True` or Electron rejects the handshake with 403) to read
`document.title`, the resolved theme tokens, and `Page.captureScreenshot`.

Cheap checks that need no CDP at all:

```bash
osascript -e 'tell application "System Events" to get name of every window of process "Dumont Code"'
osascript -e 'tell application "System Events" to get name of every menu bar item of menu bar 1 of process "Dumont Code"'
osascript -e 'tell application "System Events" to get name of every menu item of menu 1 of menu bar item "Dumont Code" of menu bar 1 of process "Dumont Code"'
```

To find a logo you have not rebranded, ask the live DOM rather than grepping:

```js
[...document.querySelectorAll('svg')].map(s => ({ vb: s.getAttribute('viewBox'), paths: s.querySelectorAll('path').length }))
```

Anything with a wide viewBox and a handful of paths is a wordmark.

**There are exactly four logo components, and none of them is an asset file.**
All four are inline SVG in TypeScript, so grepping for `*.svg` or `*.png` finds
nothing and you conclude, wrongly, that there is no logo to rebrand.

| Component | File | Where it shows |
|---|---|---|
| `Mark` | `packages/ui/src/components/logo.tsx` | small slots: new-session header, side panel watermark |
| `Splash` | same | the launch/loading screen |
| `Logo` | same | low-opacity watermark on the home and error pages |
| `WordmarkV2` | `packages/ui/src/v2/components/wordmark-v2.tsx` | **the big faded wordmark behind the new-session composer**, the most visible one |

`WordmarkV2` has exactly one consumer,
`packages/app/src/pages/new-session/new-session-view.tsx:42`. `packages/ui` is
shared, so re-check that after an upstream merge.

### The warning that matters most

The build was green. The test suite passed. `bun typecheck` passed across all 30
packages. The grep over the **built** app for `opencode.ai`, `sst/opencode` and
`releases.opencode` came back clean. Every gate said the rebrand was finished.

The first screen a user sees still said **opencode** in letters a third of the
window wide.

A grep and a green build do not prove branding. The only reliable check for this
app is to launch the built app and look at it.

## Not done

- Windows and Linux. The config is rebranded for both and `icon.ico` plus the
  Linux hicolor set are generated, but neither has been built or tested. Windows
  additionally needs the `sign-windows.ps1` path, which is GitHub-Actions-only
  upstream.
- Publishing to the App Store. Deliberately not pursued: it forces sandboxing and
  per-release review for no benefit on a DMG served from dumont.au.
