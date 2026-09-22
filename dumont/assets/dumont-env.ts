import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * The Dumont layer for the desktop app.
 *
 * Without this the app is branded but has nothing else of Dumont in it: no team
 * config, no team memory, no team permissions, no skills, and no provider keys.
 * It then falls back to whichever provider the server happens to list first,
 * which is how the first message anyone sent hit OpenCode Zen, an unfunded
 * gateway, and came back `api_error: Unauthorized`.
 *
 * This mirrors what bin/dumont-code does in DumontAI/dumont-code: point the
 * engine at the Dumont config dir, and load the shared provider keys.
 *
 * Everything here is optional. A machine with no Dumont install gets an empty
 * object and stock behaviour, never a crash.
 */

export const DUMONT_CONFIG_DIR = join(homedir(), ".config", "dumont-code")
export const DUMONT_KEYS_FILE = join(homedir(), ".config", "dumont", "llm-keys.env")

/**
 * Parse an `llm-keys.env` file: `export KEY=value` lines, comments, blanks.
 *
 * Deliberately not a shell. The file is ours and is documented as simple
 * assignments, and running it through a shell to read three keys would be a
 * remote-code-execution shaped hole for no benefit.
 */
export function parseKeysFile(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line
    const eq = body.indexOf("=")
    if (eq <= 0) continue
    const key = body.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = body.slice(eq + 1).trim()
    // Strip one matching pair of surrounding quotes, the only quoting the file uses.
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    if (!value) continue
    env[key] = value
  }
  return env
}

type Logger = { log: (message: string, data?: unknown) => void }

/**
 * Environment to merge into the main process before the server sidecar is
 * forked. Returns `{}` when nothing Dumont is installed.
 *
 * These values win over the probed shell environment, matching bin/dumont-code,
 * which sources the keys file unconditionally before exec'ing the engine. One
 * source of truth for the team beats whatever a particular shell profile has
 * drifted to.
 */
export function dumontEnv(logger?: Logger): Record<string, string> {
  const env: Record<string, string> = {}

  try {
    if (existsSync(DUMONT_CONFIG_DIR) && statSync(DUMONT_CONFIG_DIR).isDirectory()) {
      // Additive, not a replacement: the engine appends this to its config
      // directory list (ConfigPaths.directories) and merges it last, so a dev's
      // own ~/.config/opencode still loads and Dumont's config wins conflicts.
      env.OPENCODE_CONFIG_DIR = DUMONT_CONFIG_DIR
      logger?.log("[dumont] using Dumont config dir", { path: DUMONT_CONFIG_DIR })
    } else {
      logger?.log("[dumont] no Dumont config dir, using stock config", { path: DUMONT_CONFIG_DIR })
    }
  } catch (error) {
    logger?.log("[dumont] could not stat the Dumont config dir", { error: String(error) })
  }

  try {
    if (existsSync(DUMONT_KEYS_FILE)) {
      const keys = parseKeysFile(readFileSync(DUMONT_KEYS_FILE, "utf8"))
      Object.assign(env, keys)
      // Names only. Never the values: this goes to a log file on disk.
      logger?.log("[dumont] loaded provider keys", { file: DUMONT_KEYS_FILE, keys: Object.keys(keys).sort() })
    } else {
      logger?.log("[dumont] no provider keys file", { path: DUMONT_KEYS_FILE })
    }
  } catch (error) {
    logger?.log("[dumont] could not read the provider keys file", { error: String(error) })
  }

  return env
}
