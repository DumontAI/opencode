import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context, Schema, Scope } from "effect"
import { formatPatch, structuredPatch } from "diff"
import { InstanceState } from "@/effect/instance-state"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Git } from "@/git"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { VcsEvent } from "@opencode-ai/schema/vcs-event"

const PATCH_CONTEXT_LINES = 2_147_483_647
const MAX_PATCH_BYTES = 10_000_000
const MAX_TOTAL_PATCH_BYTES = 10_000_000
type DiffOptions = {
  readonly context?: number
}

const emptyPatch = (file: string) => formatPatch(structuredPatch(file, file, "", "", "", "", { context: 0 }))

const nums = (list: Git.Stat[]) =>
  new Map(list.map((item) => [item.file, { additions: item.additions, deletions: item.deletions }] as const))

const merge = (...lists: Git.Item[][]) => {
  const out = new Map<string, Git.Item>()
  lists.flat().forEach((item) => {
    if (!out.has(item.file)) out.set(item.file, item)
  })
  return [...out.values()]
}

const emptyBatch = () => ({ patches: new Map<string, string>(), capped: false })

const parseQuotedPath = (value: string) => {
  let out = ""
  for (let idx = 1; idx < value.length; idx++) {
    const char = value[idx]
    if (char === '"') return { value: out, end: idx + 1 }
    if (char !== "\\") {
      out += char
      continue
    }

    const next = value[++idx]
    if (next === "t") out += "\t"
    else if (next === "n") out += "\n"
    else if (next === "r") out += "\r"
    else if (next === '"' || next === "\\") out += next
    else out += next ?? ""
  }
}

const parsePathToken = (value: string) => {
  if (!value.startsWith('"')) return value.split("\t")[0]
  return parseQuotedPath(value)?.value ?? value
}

const fileFromDiffPath = (value: string | undefined) => {
  if (!value || value === "/dev/null") return
  const file = parsePathToken(value)
  if (file.startsWith("a/") || file.startsWith("b/")) return file.slice(2)
  return file
}

const fileFromGitHeader = (header: string) => {
  if (header.startsWith('"')) {
    const first = parseQuotedPath(header)
    const second = first ? header.slice(first.end).trimStart() : undefined
    if (!second) return
    if (!second.startsWith('"')) return fileFromDiffPath(second)
    return fileFromDiffPath(parseQuotedPath(second)?.value)
  }

  const separator = header.indexOf(" b/")
  if (separator === -1) return
  return fileFromDiffPath(header.slice(separator + 1))
}

const fileFromPatchChunk = (chunk: string) => {
  const next = /^\+\+\+ (.+)$/m.exec(chunk)?.[1]
  const before = /^--- (.+)$/m.exec(chunk)?.[1]
  const file = fileFromDiffPath(next) ?? fileFromDiffPath(before)
  if (file) return file

  const header = /^diff --git (.+)$/m.exec(chunk)?.[1]
  return fileFromGitHeader(header ?? "")
}

const splitGitPatch = (patch: Git.Patch) => {
  const starts = [...patch.text.matchAll(/(?:^|\n)diff --git /g)].map((match) =>
    match[0].startsWith("\n") ? match.index + 1 : match.index,
  )
  const chunks = starts.map((start, index) => patch.text.slice(start, starts[index + 1] ?? patch.text.length))
  if (!patch.truncated) return chunks
  return chunks.slice(0, -1)
}

const batchPatches = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string,
  list: Git.Item[],
  options?: DiffOptions,
) {
  if (list.length === 0) return { patches: new Map<string, string>(), capped: false }

  const result = yield* git.patchAll(cwd, ref, {
    context: options?.context ?? PATCH_CONTEXT_LINES,
    maxOutputBytes: MAX_TOTAL_PATCH_BYTES,
  })

  return {
    patches: splitGitPatch(result).reduce((acc, patch, index) => {
      const file = fileFromPatchChunk(patch) ?? list[index]?.file
      if (!file) return acc
      acc.set(file, (acc.get(file) ?? "") + patch)
      return acc
    }, new Map<string, string>()),
    capped: result.truncated,
  }
})

const nativePatch = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string | undefined,
  item: Git.Item,
  options?: DiffOptions,
) {
  const result =
    item.code === "??" || !ref
      ? yield* git.patchUntracked(cwd, item.file, {
          context: options?.context ?? PATCH_CONTEXT_LINES,
          maxOutputBytes: MAX_PATCH_BYTES,
        })
      : yield* git.patch(cwd, ref, item.file, {
          context: options?.context ?? PATCH_CONTEXT_LINES,
          maxOutputBytes: MAX_PATCH_BYTES,
        })
  if (!result.truncated && result.text) return result.text

  return emptyPatch(item.file)
})

const totalPatch = (file: string, patch: string, total: number) => {
  if (total + Buffer.byteLength(patch) <= MAX_TOTAL_PATCH_BYTES) return { patch, capped: false }
  return { patch: emptyPatch(file), capped: true }
}

const patchForItem = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string | undefined,
  item: Git.Item,
  batch: { patches: Map<string, string>; capped: boolean },
  capped: boolean,
  options?: DiffOptions,
) {
  if (capped) return emptyPatch(item.file)

  const batched = batch.patches.get(item.file)
  if (batched !== undefined) return batched
  if (item.code !== "??" && batch.capped) return emptyPatch(item.file)
  return yield* nativePatch(git, cwd, ref, item, options)
})

const files = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string | undefined,
  list: Git.Item[],
  map: Map<string, { additions: number; deletions: number }>,
  batch: { patches: Map<string, string>; capped: boolean },
  options?: DiffOptions,
) {
  const next: FileDiff[] = []
  let total = 0
  let capped = false

  for (const item of list.toSorted((a, b) => a.file.localeCompare(b.file))) {
    const stat = map.get(item.file) ?? (item.status === "added" ? yield* git.statUntracked(cwd, item.file) : undefined)
    const patch = yield* patchForItem(git, cwd, ref, item, batch, capped, options)
    const result: { patch: string; capped: boolean } = capped
      ? { patch, capped: true }
      : totalPatch(item.file, patch, total)
    capped = capped || result.capped
    if (!capped) {
      total += Buffer.byteLength(result.patch)
      capped = total >= MAX_TOTAL_PATCH_BYTES
    }
    next.push({
      file: item.file,
      patch: result.patch,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
      status: item.status,
    })
  }

  return next
})

const diffAgainstRef = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string,
  options?: DiffOptions,
) {
  const [list, stats, extra] = yield* Effect.all([git.diff(cwd, ref), git.stats(cwd, ref), git.status(cwd)], {
    concurrency: 3,
  })
  return yield* files(
    git,
    cwd,
    ref,
    merge(
      list,
      extra.filter((item) => item.code === "??"),
    ),
    nums(stats),
    yield* batchPatches(git, cwd, ref, list, options),
    options,
  )
})

const track = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string | undefined,
  options?: DiffOptions,
) {
  if (!ref) return yield* files(git, cwd, ref, yield* git.status(cwd), new Map(), emptyBatch(), options)
  return yield* diffAgainstRef(git, cwd, ref, options)
})

export const Mode = Schema.Literals(["git", "branch"])
export type Mode = Schema.Schema.Type<typeof Mode>

export const Event = VcsEvent

export const Info = Schema.Struct({
  branch: Schema.optional(Schema.String),
  default_branch: Schema.optional(Schema.String),
}).annotate({ identifier: "VcsInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export const FileDiff = Schema.Struct({
  file: Schema.String,
  // Mirrors Snapshot.FileDiff (see #26574). The current producer always
  // populates patch, but loosening matches the sibling schema so a
  // future code path that omits it can't crash /instance/vcs/diff.
  patch: Schema.optional(Schema.String),
  additions: Schema.Finite,
  deletions: Schema.Finite,
  status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])),
}).annotate({ identifier: "VcsFileDiff" })
export type FileDiff = Schema.Schema.Type<typeof FileDiff>

export const FileStatus = Schema.Struct({
  file: Schema.String,
  additions: Schema.Finite,
  deletions: Schema.Finite,
  status: Schema.Literals(["added", "deleted", "modified"]),
}).annotate({ identifier: "VcsFileStatus" })
export type FileStatus = Schema.Schema.Type<typeof FileStatus>

export const ApplyInput = Schema.Struct({
  patch: Schema.String,
})
export type ApplyInput = Schema.Schema.Type<typeof ApplyInput>

export const ApplyResult = Schema.Struct({
  applied: Schema.Boolean,
})
export type ApplyResult = Schema.Schema.Type<typeof ApplyResult>

export class PatchApplyError extends Schema.TaggedErrorClass<PatchApplyError>()("VcsPatchApplyError", {
  message: Schema.String,
  reason: Schema.Literals(["non-git", "not-clean"]),
}) {}

export const ActionOperation = Schema.Literals(["commit", "merge", "fetch"])
export type ActionOperation = Schema.Schema.Type<typeof ActionOperation>

export const ActionReason = Schema.Literals([
  "non-git",
  "no-changes",
  "dirty",
  "merge-in-progress",
  "conflicts",
  "failed",
])
export type ActionReason = Schema.Schema.Type<typeof ActionReason>

export class ActionError extends Schema.TaggedErrorClass<ActionError>()("VcsActionError", {
  operation: ActionOperation,
  reason: ActionReason,
  message: Schema.String,
}) {}

export const SyncInfo = Schema.Struct({
  branch: Schema.optional(Schema.String),
  upstream: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  ahead: Schema.Finite,
  behind: Schema.Finite,
  dirty: Schema.Finite,
  conflicts: Schema.Finite,
  merging: Schema.Boolean,
}).annotate({ identifier: "VcsSyncInfo" })
export type SyncInfo = Schema.Schema.Type<typeof SyncInfo>

export const CommitInput = Schema.Struct({
  message: Schema.String,
})
export type CommitInput = Schema.Schema.Type<typeof CommitInput>

export const CommitResult = Schema.Struct({
  commit: Schema.String,
})
export type CommitResult = Schema.Schema.Type<typeof CommitResult>

export const MergeInput = Schema.Struct({
  base: Schema.optional(Schema.String),
})
export type MergeInput = Schema.Schema.Type<typeof MergeInput>

export const MergeResult = Schema.Struct({
  base: Schema.String,
  conflicts: Schema.Array(Schema.String),
})
export type MergeResult = Schema.Schema.Type<typeof MergeResult>

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly branch: () => Effect.Effect<string | undefined>
  readonly defaultBranch: () => Effect.Effect<string | undefined>
  readonly status: () => Effect.Effect<FileStatus[]>
  readonly diff: (mode: Mode, options?: DiffOptions) => Effect.Effect<FileDiff[]>
  readonly diffRaw: () => Effect.Effect<string>
  readonly apply: (input: ApplyInput) => Effect.Effect<ApplyResult, PatchApplyError>
  readonly sync: () => Effect.Effect<SyncInfo>
  readonly commit: (input: CommitInput) => Effect.Effect<CommitResult, ActionError>
  readonly merge: (input: MergeInput) => Effect.Effect<MergeResult, ActionError>
  readonly fetch: () => Effect.Effect<SyncInfo, ActionError>
}

interface State {
  current: string | undefined
  root: Git.Base | undefined
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Vcs") {}

const layer: Layer.Layer<Service, never, Git.Service | EventV2Bridge.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const git = yield* Git.Service
    const events = yield* EventV2Bridge.Service
    const scope = yield* Scope.Scope

    const state = yield* InstanceState.make<State>(
      Effect.fn("Vcs.state")(function* (ctx) {
        if (ctx.project.vcs !== "git") {
          return { current: undefined, root: undefined }
        }

        const get = Effect.fnUntraced(function* () {
          return yield* git.branch(ctx.directory)
        })
        const [current, root] = yield* Effect.all([git.branch(ctx.directory), git.defaultBranch(ctx.directory)], {
          concurrency: 2,
        })
        const value = { current, root }

        const unsubscribe = yield* events.listen((event) => {
          if (event.type !== Watcher.Event.Updated.type || event.location?.directory !== ctx.directory)
            return Effect.void
          const data = event.data as EventV2.Data<typeof Watcher.Event.Updated>
          if (!data.file.endsWith("HEAD")) return Effect.void
          return Effect.gen(function* () {
            const next = yield* get()
            if (next !== value.current) {
              value.current = next
              yield* events.publish(Event.BranchUpdated, { branch: next })
            }
          })
        })
        yield* Effect.addFinalizer(() => unsubscribe)

        return value
      }),
    )

    const conflictCodes = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"])
    const failMessage = (result: Git.Result) =>
      result.stderr.toString("utf8").trim() || result.text().trim() || "git command failed"

    const resolveBase = Effect.fn("Vcs.resolveBase")(function* () {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") return

      const [branch, upstream, primary, root] = yield* Effect.all(
        [
          git.branch(ctx.directory),
          git.upstream(ctx.directory),
          git.primaryRemote(ctx.directory),
          git.defaultBranch(ctx.directory),
        ],
        { concurrency: 4 },
      )

      const staging = primary ? `${primary}/staging` : "origin/staging"
      const upstreamName = upstream && upstream.includes("/") ? upstream.slice(upstream.indexOf("/") + 1) : undefined
      const stable = branch === "staging" || branch === "main" || branch === "master"

      if (!stable) {
        if (yield* git.refExists(ctx.directory, staging)) return staging
        if (upstream && upstreamName !== branch) return upstream
      } else if (upstream) {
        return upstream
      }

      if (root) {
        const remote = primary ? `${primary}/${root.name}` : undefined
        if (remote && (yield* git.refExists(ctx.directory, remote))) return remote
        return root.ref
      }

      return upstream
    })

    const sync = Effect.fn("Vcs.sync")(function* () {
      const ctx = yield* InstanceState.context
      const empty = { ahead: 0, behind: 0, dirty: 0, conflicts: 0, merging: false }
      if (ctx.project.vcs !== "git") return empty

      const [branch, upstream, base, status, merging] = yield* Effect.all(
        [
          git.branch(ctx.directory),
          git.upstream(ctx.directory),
          resolveBase(),
          git.status(ctx.directory),
          git.isMerging(ctx.directory),
        ],
        { concurrency: 5 },
      )
      const counts = base ? yield* git.aheadBehind(ctx.directory, base) : { ahead: 0, behind: 0 }

      return {
        branch,
        upstream,
        base,
        ahead: counts.ahead,
        behind: counts.behind,
        dirty: status.length,
        conflicts: status.filter((item) => conflictCodes.has(item.code)).length,
        merging,
      } satisfies SyncInfo
    })

    const commit = Effect.fn("Vcs.commit")(function* (input: CommitInput) {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") {
        return yield* new ActionError({
          operation: "commit",
          reason: "non-git",
          message: "Changes can't be committed because the project is not git-based",
        })
      }

      const message = input.message.trim()
      if (!message) {
        return yield* new ActionError({
          operation: "commit",
          reason: "failed",
          message: "Commit message is required",
        })
      }

      const added = yield* git.addAll(ctx.directory)
      if (added.exitCode !== 0) {
        return yield* new ActionError({ operation: "commit", reason: "failed", message: failMessage(added) })
      }
      if (!(yield* git.hasStaged(ctx.directory))) {
        return yield* new ActionError({
          operation: "commit",
          reason: "no-changes",
          message: "There are no changes to commit",
        })
      }

      const result = yield* git.commit(ctx.directory, message)
      if (result.exitCode !== 0) {
        return yield* new ActionError({ operation: "commit", reason: "failed", message: failMessage(result) })
      }

      const hash = yield* git.head(ctx.directory)
      return { commit: hash?.slice(0, 12) ?? "" }
    })

    const merge = Effect.fn("Vcs.merge")(function* (input: MergeInput) {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") {
        return yield* new ActionError({
          operation: "merge",
          reason: "non-git",
          message: "Branches can't be merged because the project is not git-based",
        })
      }

      const base = input.base?.trim() || (yield* resolveBase())
      if (!base) {
        return yield* new ActionError({
          operation: "merge",
          reason: "failed",
          message: "No base branch to merge",
        })
      }
      if (yield* git.isMerging(ctx.directory)) {
        return yield* new ActionError({
          operation: "merge",
          reason: "merge-in-progress",
          message: "A merge is already in progress",
        })
      }

      const status = yield* git.status(ctx.directory)
      if (status.length > 0) {
        return yield* new ActionError({
          operation: "merge",
          reason: "dirty",
          message: "Commit your changes before merging",
        })
      }
      if (!(yield* git.refExists(ctx.directory, base))) {
        return yield* new ActionError({
          operation: "merge",
          reason: "failed",
          message: `Base branch ${base} was not found`,
        })
      }

      const result = yield* git.merge(ctx.directory, base)
      if (result.exitCode === 0) return { base, conflicts: [] }

      const after = yield* git.status(ctx.directory)
      const conflicts = after.filter((item) => conflictCodes.has(item.code)).map((item) => item.file)
      if (conflicts.length > 0) return { base, conflicts }

      return yield* new ActionError({ operation: "merge", reason: "failed", message: failMessage(result) })
    })

    const fetch = Effect.fn("Vcs.fetch")(function* () {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") {
        return yield* new ActionError({
          operation: "fetch",
          reason: "non-git",
          message: "Branches can't be fetched because the project is not git-based",
        })
      }

      const base = yield* resolveBase()
      if (base) {
        const separator = base.indexOf("/")
        const remote = separator === -1 ? yield* git.primaryRemote(ctx.directory) : base.slice(0, separator)
        const branch = separator === -1 ? base : base.slice(separator + 1)
        if (remote && branch) {
          const result = yield* git.fetchBranch(ctx.directory, { remote, branch })
          if (result.exitCode !== 0) {
            return yield* new ActionError({ operation: "fetch", reason: "failed", message: failMessage(result) })
          }
        }
      }

      return yield* sync()
    })

    return Service.of({
      init: Effect.fn("Vcs.init")(function* () {
        yield* InstanceState.get(state).pipe(Effect.forkIn(scope))
      }),
      branch: Effect.fn("Vcs.branch")(function* () {
        return yield* InstanceState.use(state, (x) => x.current)
      }),
      defaultBranch: Effect.fn("Vcs.defaultBranch")(function* () {
        return yield* InstanceState.use(state, (x) => x.root?.name)
      }),
      status: Effect.fn("Vcs.status")(function* () {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return []
        const ref = (yield* git.hasHead(ctx.directory)) ? "HEAD" : undefined
        const [list, stats] = yield* Effect.all(
          [git.status(ctx.directory), ref ? git.stats(ctx.directory, ref) : Effect.succeed([])],
          { concurrency: 2 },
        )
        const map = nums(stats)
        return yield* Effect.forEach(
          list.toSorted((a, b) => a.file.localeCompare(b.file)),
          (item) =>
            Effect.gen(function* () {
              const stat =
                map.get(item.file) ??
                (item.status === "added" ? yield* git.statUntracked(ctx.worktree, item.file) : undefined)
              return {
                file: item.file,
                additions: stat?.additions ?? 0,
                deletions: stat?.deletions ?? 0,
                status: item.status,
              } satisfies FileStatus
            }),
        )
      }),
      diff: Effect.fn("Vcs.diff")(function* (mode: Mode, options?: DiffOptions) {
        const value = yield* InstanceState.get(state)
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return []
        if (mode === "git") {
          return yield* track(git, ctx.directory, (yield* git.hasHead(ctx.directory)) ? "HEAD" : undefined, options)
        }

        if (!value.root) return []
        if (value.current && value.current === value.root.name) return []
        const ref = yield* git.mergeBase(ctx.directory, value.root.ref)
        if (!ref) return []
        return yield* diffAgainstRef(git, ctx.directory, ref, options)
      }),
      diffRaw: Effect.fn("Vcs.diffRaw")(function* () {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return ""
        const [hasHead, status] = yield* Effect.all([git.hasHead(ctx.directory), git.status(ctx.directory)], {
          concurrency: 2,
        })
        const tracked = hasHead ? (yield* git.patchAll(ctx.directory, "HEAD")).text : ""
        const untracked = yield* Effect.forEach(
          status.filter((item) => item.code === "??"),
          (item) => git.patchUntracked(ctx.directory, item.file).pipe(Effect.map((patch) => patch.text)),
        )
        return [tracked, ...untracked].filter(Boolean).join("\n")
      }),
      apply: Effect.fn("Vcs.apply")(function* (input: ApplyInput) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") {
          return yield* new PatchApplyError({
            message: "Patch can't be applied because the project is not git-based",
            reason: "non-git",
          })
        }
        const applied = yield* git.applyPatch(ctx.directory, input.patch)
        if (applied.exitCode !== 0) {
          return yield* new PatchApplyError({
            message: "Patch can't be applied",
            reason: "not-clean",
          })
        }
        return { applied: true }
      }),
      sync,
      commit,
      merge,
      fetch,
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [Git.node, EventV2Bridge.node] })

export * as Vcs from "./vcs"
