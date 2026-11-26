import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { parsePatch } from "diff"
import { Deferred, Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import {
  disposeAllInstances,
  provideInstance,
  testInstanceStoreLayer,
  TestInstance,
  tmpdirScoped,
} from "../fixture/fixture"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Git } from "../../src/git"
import { Vcs } from "@/project/vcs"
import { testEffect } from "../lib/effect"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const weird = process.platform === "win32" ? "space file.txt" : "tab\tfile.txt"

const layer = LayerNode.compile(
  LayerNode.group([Vcs.node, Git.node, EventV2Bridge.node, FSUtil.node, CrossSpawnSpawner.node]),
)
const it = testEffect(layer)
const worktreeIt = testEffect(Layer.mergeAll(layer, testInstanceStoreLayer))

const git = Effect.fn("VcsTest.git")(function* (cwd: string, args: string[]) {
  const result = yield* Git.Service.use((git) => git.run(args, { cwd }))
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString("utf8")}`)
})

const write = Effect.fn("VcsTest.write")(function* (file: string, content: string) {
  yield* FSUtil.Service.use((fs) => fs.writeWithDirs(file, content))
})

const remove = Effect.fn("VcsTest.remove")(function* (file: string) {
  yield* FSUtil.Service.use((fs) => fs.remove(file))
})

const symlink = (target: string, file: string) => Effect.promise(() => fs.symlink(target, file))

const init = Effect.fn("VcsTest.init")(function* () {
  const vcs = yield* Vcs.Service
  yield* vcs.init()
  return vcs
})

const nextBranchUpdate = Effect.fn("VcsTest.nextBranchUpdate")(function* () {
  const events = yield* EventV2Bridge.Service
  const updated = yield* Deferred.make<string | undefined>()

  const off = yield* events.listen((event) => {
    if (event.type === Vcs.Event.BranchUpdated.type)
      Deferred.doneUnsafe(updated, Effect.succeed((event.data as typeof Vcs.Event.BranchUpdated.data.Type).branch))
    return Effect.void
  })
  yield* Effect.addFinalizer(() => off)

  return updated
})

const publishHeadChangeUntil = Effect.fn("VcsTest.publishHeadChangeUntil")(function* (
  pending: Deferred.Deferred<string | undefined>,
  head: string,
) {
  const events = yield* EventV2Bridge.Service
  for (let i = 0; i < 50; i++) {
    yield* events.publish(Watcher.Event.Updated, { file: head, event: "change" })
    if (yield* Deferred.isDone(pending)) return
    yield* Effect.sleep("10 millis")
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Vcs", () => {
  afterEach(async () => {
    await disposeAllInstances()
  })

  it.instance(
    "branch() returns current branch name",
    () =>
      Effect.gen(function* () {
        const vcs = yield* init()
        const branch = yield* vcs.branch()

        expect(branch).toBeDefined()
        expect(typeof branch).toBe("string")
      }),
    { git: true },
  )

  it.instance("branch() returns undefined for non-git directories", () =>
    Effect.gen(function* () {
      const vcs = yield* init()
      const branch = yield* vcs.branch()

      expect(branch).toBeUndefined()
    }),
  )

  it.instance(
    "publishes BranchUpdated when .git/HEAD changes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const branch = `test-${Math.random().toString(36).slice(2)}`
        yield* git(test.directory, ["branch", branch])

        const vcs = yield* init()
        yield* vcs.branch()
        const pending = yield* nextBranchUpdate()

        const head = path.join(test.directory, ".git", "HEAD")
        yield* write(head, `ref: refs/heads/${branch}\n`)
        yield* publishHeadChangeUntil(pending, head)

        const updated = yield* Deferred.await(pending).pipe(Effect.timeout("2 seconds"))
        expect(updated).toBe(branch)
      }),
    { git: true },
  )

  it.instance(
    "branch() reflects the new branch after HEAD change",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const branch = `test-${Math.random().toString(36).slice(2)}`
        yield* git(test.directory, ["branch", branch])

        const vcs = yield* init()
        yield* vcs.branch()
        const pending = yield* nextBranchUpdate()

        const head = path.join(test.directory, ".git", "HEAD")
        yield* write(head, `ref: refs/heads/${branch}\n`)
        yield* publishHeadChangeUntil(pending, head)
        yield* Deferred.await(pending).pipe(Effect.timeout("2 seconds"))

        const current = yield* vcs.branch()
        expect(current).toBe(branch)
      }),
    { git: true },
  )
})

describe("Vcs diff", () => {
  afterEach(async () => {
    await disposeAllInstances()
  })

  it.instance(
    "defaultBranch() falls back to main",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* git(test.directory, ["branch", "-M", "main"])

        const vcs = yield* init()
        const branch = yield* vcs.defaultBranch()

        expect(branch).toBe("main")
      }),
    { git: true },
  )

  it.instance(
    "defaultBranch() uses init.defaultBranch when available",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* git(test.directory, ["branch", "-M", "trunk"])
        yield* git(test.directory, ["config", "init.defaultBranch", "trunk"])

        const vcs = yield* init()
        const branch = yield* vcs.defaultBranch()

        expect(branch).toBe("trunk")
      }),
    { git: true },
  )

  worktreeIt.live("detects current branch from the active worktree", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const wt = yield* tmpdirScoped()
      yield* git(tmp, ["branch", "-M", "main"])
      const dir = path.join(wt, "feature")
      yield* git(tmp, ["worktree", "add", "-b", "feature/test", dir, "HEAD"])

      const [branch, base] = yield* Effect.gen(function* () {
        const vcs = yield* init()
        return yield* Effect.all([vcs.branch(), vcs.defaultBranch()], { concurrency: 2 })
      }).pipe(provideInstance(dir))

      expect(branch).toBeDefined()
      expect(branch).toBe("feature/test")
      expect(base).toBe("main")
    }),
  )

  it.instance(
    "diff('git') returns uncommitted changes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* write(path.join(test.directory, "file.txt"), "original\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "add file"])
        yield* write(path.join(test.directory, "file.txt"), "changed\n")

        const vcs = yield* init()
        const diff = yield* vcs.diff("git")

        expect(diff).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              file: "file.txt",
              status: "modified",
            }),
          ]),
        )
        expect(diff.find((item) => item.file === "file.txt")?.patch).toContain("diff --git")
      }),
    { git: true },
  )

  it.instance(
    "diff('git') handles special filenames",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* write(path.join(test.directory, weird), "hello\n")

        const vcs = yield* init()
        const diff = yield* vcs.diff("git")

        expect(diff).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              file: weird,
              status: "added",
            }),
          ]),
        )
      }),
    { git: true },
  )

  it.instance(
    "diff('git') keeps batched patches aligned for type changes",
    () =>
      Effect.gen(function* () {
        if (process.platform === "win32") return

        const test = yield* TestInstance
        yield* write(path.join(test.directory, "a.txt"), "old\n")
        yield* write(path.join(test.directory, "b.txt"), "old\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "add files"])
        yield* remove(path.join(test.directory, "a.txt"))
        yield* symlink("target", path.join(test.directory, "a.txt"))
        yield* write(path.join(test.directory, "b.txt"), "new\n")

        const vcs = yield* init()
        const diff = yield* vcs.diff("git")
        const a = diff.find((item) => item.file === "a.txt")
        const b = diff.find((item) => item.file === "b.txt")

        expect(a?.patch).toContain("deleted file mode")
        expect(a?.patch).toContain("new file mode")
        expect(b?.patch).toContain("+new")
      }),
    { git: true },
  )

  it.instance(
    "diff('git') keeps carriage returns inside patch hunks",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* write(path.join(test.directory, "file.txt"), "keep\nsame\rdiff --git inside\ndelete\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "add file"])
        yield* write(path.join(test.directory, "file.txt"), "keep\nadd\nsame\rdiff --git inside\n")

        const vcs = yield* init()
        const diff = yield* vcs.diff("git")
        const file = diff.find((item) => item.file === "file.txt")

        expect(file?.patch).toContain(" same\rdiff --git inside")
        expect(file?.patch).toContain("-delete")
        expect(() => parsePatch(file?.patch ?? "")).not.toThrow()
      }),
    { git: true },
    20_000,
  )

  it.instance(
    "diff('branch') returns changes against default branch",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* git(test.directory, ["branch", "-M", "main"])
        yield* git(test.directory, ["checkout", "-b", "feature/test"])
        yield* write(path.join(test.directory, "branch.txt"), "hello\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "branch file"])

        const vcs = yield* init()
        const diff = yield* vcs.diff("branch")

        expect(diff).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              file: "branch.txt",
              status: "added",
            }),
          ]),
        )
      }),
    { git: true },
  )
})

// ---------------------------------------------------------------------------
// VCS actions
// ---------------------------------------------------------------------------

const gitText = Effect.fn("VcsTest.gitText")(function* (cwd: string, args: string[]) {
  const result = yield* Git.Service.use((git) => git.run(args, { cwd }))
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString("utf8")}`)
  return result.text().trim()
})

const cloneRemote = Effect.fn("VcsTest.cloneRemote")(function* (remote: string, branch: string) {
  const root = yield* tmpdirScoped()
  const dir = path.join(root, "clone")
  yield* git(root, ["clone", remote, dir])
  yield* git(dir, ["config", "user.email", "test@opencode.test"])
  yield* git(dir, ["config", "user.name", "Test"])
  yield* git(dir, ["checkout", branch])
  return dir
})

const setupRemote = Effect.fn("VcsTest.setupRemote")(function* (cwd: string, file: string, content: string) {
  yield* git(cwd, ["branch", "-M", "main"])
  yield* write(path.join(cwd, file), content)
  yield* git(cwd, ["add", "."])
  yield* git(cwd, ["commit", "--no-gpg-sign", "-m", "base"])

  const remoteRoot = yield* tmpdirScoped()
  const remote = path.join(remoteRoot, "remote.git")
  yield* git(remoteRoot, ["init", "--bare", remote])
  yield* git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"])
  yield* git(cwd, ["remote", "add", "origin", remote])
  yield* git(cwd, ["push", "-u", "origin", "main"])

  return { remote, other: yield* cloneRemote(remote, "main") }
})

describe("Vcs actions", () => {
  afterEach(async () => {
    await disposeAllInstances()
  })

  it.instance(
    "sync() reports ahead and behind against the base branch",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const { other } = yield* setupRemote(test.directory, "base.txt", "base\n")

        yield* git(test.directory, ["checkout", "-b", "feature"])
        yield* write(path.join(test.directory, "feature.txt"), "feature\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "feature"])

        yield* write(path.join(other, "main.txt"), "main\n")
        yield* git(other, ["add", "."])
        yield* git(other, ["commit", "--no-gpg-sign", "-m", "main"])
        yield* git(other, ["push", "origin", "main"])
        yield* git(test.directory, ["fetch", "origin"])

        const vcs = yield* init()
        const sync = yield* vcs.sync()

        expect(sync.branch).toBe("feature")
        expect(sync.base).toBe("origin/main")
        expect(sync.ahead).toBe(1)
        expect(sync.behind).toBe(1)
        expect(sync.dirty).toBe(0)
        expect(sync.merging).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "fetch() updates the behind count from the remote",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const { other } = yield* setupRemote(test.directory, "base.txt", "base\n")

        yield* git(test.directory, ["checkout", "-b", "feature"])
        yield* git(other, ["pull", "--ff-only", "origin", "main"])

        const vcs = yield* init()
        yield* vcs.sync()

        yield* write(path.join(other, "later.txt"), "later\n")
        yield* git(other, ["add", "."])
        yield* git(other, ["commit", "--no-gpg-sign", "-m", "later"])
        yield* git(other, ["push", "origin", "main"])

        const before = yield* vcs.sync()
        expect(before.behind).toBe(0)

        const after = yield* vcs.fetch()
        expect(after.base).toBe("origin/main")
        expect(after.behind).toBe(1)
      }),
    { git: true },
  )

  it.instance(
    "commit() stages all changes and reports the commit",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* write(path.join(test.directory, "tracked.txt"), "one\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "tracked"])

        yield* write(path.join(test.directory, "tracked.txt"), "two\n")
        yield* write(path.join(test.directory, "untracked.txt"), "new\n")

        const vcs = yield* init()
        const result = yield* vcs.commit({ message: "test: commit all changes" })

        expect(result.commit).toMatch(/^[0-9a-f]{7,12}$/)
        expect(yield* gitText(test.directory, ["log", "-1", "--pretty=%s"])).toBe("test: commit all changes")
        expect(yield* gitText(test.directory, ["status", "--porcelain"])).toBe("")

        const sync = yield* vcs.sync()
        expect(sync.dirty).toBe(0)

        const error = yield* vcs.commit({ message: "test: nothing left" }).pipe(Effect.flip)
        expect(error.reason).toBe("no-changes")
      }),
    { git: true },
  )

  it.instance(
    "merge() merges the base branch when the tree is clean",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const { other } = yield* setupRemote(test.directory, "file.txt", "base\n")

        yield* git(test.directory, ["checkout", "-b", "feature"])
        yield* write(path.join(test.directory, "feature.txt"), "feature\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "feature"])

        yield* write(path.join(other, "main.txt"), "main\n")
        yield* git(other, ["add", "."])
        yield* git(other, ["commit", "--no-gpg-sign", "-m", "main"])
        yield* git(other, ["push", "origin", "main"])
        yield* git(test.directory, ["fetch", "origin"])

        const vcs = yield* init()
        const before = yield* vcs.sync()
        expect(before.behind).toBe(1)

        const result = yield* vcs.merge({})
        expect(result.base).toBe("origin/main")
        expect(result.conflicts).toEqual([])

        const after = yield* vcs.sync()
        expect(after.behind).toBe(0)
        expect(after.ahead).toBeGreaterThanOrEqual(2)
        expect(after.merging).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "merge() refuses to run with uncommitted changes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* write(path.join(test.directory, "dirty.txt"), "dirty\n")

        const vcs = yield* init()
        const error = yield* vcs.merge({}).pipe(Effect.flip)

        expect(error.reason).toBe("dirty")
        const sync = yield* vcs.sync()
        expect(sync.merging).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "merge() reports conflicts and leaves the merge in progress",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const { other } = yield* setupRemote(test.directory, "conflict.txt", "base\n")

        yield* git(test.directory, ["checkout", "-b", "feature"])
        yield* write(path.join(test.directory, "conflict.txt"), "feature\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "feature"])

        yield* write(path.join(other, "conflict.txt"), "main\n")
        yield* git(other, ["add", "."])
        yield* git(other, ["commit", "--no-gpg-sign", "-m", "main"])
        yield* git(other, ["push", "origin", "main"])
        yield* git(test.directory, ["fetch", "origin"])

        const vcs = yield* init()
        const result = yield* vcs.merge({})

        expect(result.base).toBe("origin/main")
        expect(result.conflicts).toContain("conflict.txt")

        const sync = yield* vcs.sync()
        expect(sync.merging).toBe(true)
        expect(sync.conflicts).toBe(1)

        yield* git(test.directory, ["merge", "--abort"])
      }),
    { git: true },
  )
})
