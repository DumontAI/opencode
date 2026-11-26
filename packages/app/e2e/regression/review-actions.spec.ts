import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/ReviewActions"
const projectID = "proj_review_actions"
const sessionID = "ses_review_actions"
const title = "Review actions"

test.use({ viewport: { width: 1440, height: 900 } })

test("commits and merges from the changes panel with a behind recommendation", async ({ page }) => {
  const commits: unknown[] = []
  const merges: unknown[] = []
  let sync = {
    branch: "core/MO-1-feature",
    upstream: "origin/core/MO-1-feature",
    base: "origin/staging",
    ahead: 0,
    behind: 2,
    dirty: 1,
    conflicts: 0,
    merging: false,
  }

  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "review-actions",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "claude-opus-4-6": {
              id: "claude-opus-4-6",
              name: "Claude Opus 4.6",
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "claude-opus-4-6" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "review-actions",
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    vcsDiff: [],
    vcsSync: () => sync,
    vcsFetch: () => sync,
    vcsCommit: (body) => {
      commits.push(body)
      sync = { ...sync, dirty: 0 }
      return { commit: "abc123456789" }
    },
    vcsMerge: (body) => {
      merges.push(body)
      sync = { ...sync, behind: 0, ahead: 2 }
      return { base: "origin/staging", conflicts: [] }
    },
  })
  await configurePage(page)

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)
  await page.getByRole("button", { name: "Toggle review" }).click()

  const bar = page.locator('[data-component="review-actions"]')
  await expect(bar).toBeVisible()
  await expect(bar.getByText("core/MO-1-feature")).toBeVisible()
  await expect(bar.getByText("2 commits behind origin/staging", { exact: true })).toBeVisible()
  await expect(bar.getByText("1 changed file", { exact: true })).toBeVisible()
  await expect(
    bar.getByText(
      "You have uncommitted changes and are 2 commits behind origin/staging. Commit, then merge to avoid conflicts.",
    ),
  ).toBeVisible()

  await bar.locator('[data-action="review-commit"]').click()
  const message = bar.locator('[data-action="review-commit-message"]')
  await expect(message).toHaveValue(title)
  await message.fill("test: commit changes")
  await bar.locator('[data-action="review-commit-confirm"]').click()

  await expect.poll(() => commits.length).toBe(1)
  expect(commits[0]).toEqual({ message: "test: commit changes" })
  await expect(
    bar.getByText("You are 2 commits behind origin/staging. Merge to stay current and avoid conflicts."),
  ).toBeVisible()
  await expect(bar.locator('[data-action="review-merge"]')).toBeEnabled()

  await bar.locator('[data-action="review-merge"]').click()
  await expect(bar.getByText("Merge origin/staging into core/MO-1-feature?")).toBeVisible()
  await bar.locator('[data-action="review-merge-confirm"]').click()

  await expect.poll(() => merges.length).toBe(1)
  expect(merges[0]).toEqual({ base: "origin/staging" })
  await expect(bar.getByText("2 commits ahead", { exact: true })).toBeVisible()
  await expect(bar.getByText("You have 2 unpushed commits.")).toBeVisible()
})

async function configurePage(page: Page) {
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  await page.addInitScript(
    ({ directory, dirBase64, server, sessionID }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, dirBase64, sessionId: sessionID }]),
      )
    },
    { directory, dirBase64: base64Encode(directory), server, sessionID },
  )
}

function sessionHref(sessionID: string) {
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  return `/server/${base64Encode(server)}/session/${sessionID}`
}
