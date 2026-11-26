import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/SessionQueue"
const projectID = "proj_session_queue"
const sessionID = "ses_session_queue"
const title = "Queued follow-up"

type EventPayload = {
  directory: string
  payload: Record<string, unknown>
}

test.use({ viewport: { width: 1440, height: 900 } })

test("queues a follow-up while busy and sends it when idle", async ({ page }) => {
  const events: EventPayload[] = []
  const prompts: string[] = []
  let status: "busy" | "idle" = "busy"

  page.on("request", (request) => {
    if (request.method() !== "POST") return
    if (!new URL(request.url()).pathname.endsWith("/prompt_async")) return
    prompts.push(request.postData() ?? "")
  })

  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "session-queue",
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
        slug: "session-queue",
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    sessionStatus: () => ({ [sessionID]: { type: status } }),
    pageMessages: () => ({ items: [] }),
    events: () => events.splice(0, 1),
    eventRetry: 16,
  })
  await configurePage(page)

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)

  const composer = page.locator('[data-component="prompt-input-v2"]')
  const input = composer.locator('[data-component="prompt-input"]')
  await expect(composer).toBeVisible()
  await input.fill("queued follow up")
  await composer.locator('[data-action="prompt-submit"]').click()

  const dock = page.locator('[data-component="session-followup-dock"]')
  await expect(dock).toBeVisible()
  await expect(dock.getByText("1 queued message")).toBeVisible()
  await expect(dock.getByText("queued follow up")).toBeVisible()
  expect(prompts).toEqual([])

  status = "idle"
  events.push({
    directory,
    payload: { type: "session.status", properties: { sessionID, status: { type: "idle" } } },
  })

  await expect.poll(() => prompts.length).toBe(1)
  await expect(dock).toHaveCount(0)
  expect(prompts[0]).toContain("queued follow up")
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
