import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/SessionPlanBuild"
const projectID = "proj_session_plan_build"
const sessionID = "ses_session_plan_build"
const title = "Plan build action"
const userMessageID = "msg_plan_build_user"
const assistantMessageID = "msg_plan_build_assistant"
const model = { providerID: "opencode", modelID: "claude-opus-4-6" }

const userMessage = {
  info: {
    id: userMessageID,
    sessionID,
    role: "user",
    time: { created: 1700000000000 },
    summary: { diffs: [] },
    agent: "plan",
    model,
  },
  parts: [
    {
      id: "prt_plan_build_user_text",
      sessionID,
      messageID: userMessageID,
      type: "text",
      text: "Make a plan for the change.",
    },
  ],
}

const assistantMessage = {
  info: {
    id: assistantMessageID,
    sessionID,
    role: "assistant",
    time: { created: 1700000001000, completed: 1700000002000 },
    parentID: userMessageID,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "plan",
    agent: "plan",
    path: { cwd: directory, root: directory },
    cost: 0.01,
    tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
    variant: "max",
  },
  parts: [
    {
      id: "prt_plan_build_assistant_text",
      sessionID,
      messageID: assistantMessageID,
      type: "text",
      text: "Plan: inspect the code, change the behavior, run the tests.",
    },
  ],
}

test.use({ viewport: { width: 1440, height: 900 } })

test("offers Build after a completed plan turn and sends the build prompt", async ({ page }) => {
  const prompts: string[] = []

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
      name: "session-plan-build",
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
      default: model,
    },
    sessions: [
      {
        id: sessionID,
        slug: "session-plan-build",
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [userMessage, assistantMessage] }),
  })
  await configurePage(page)

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)

  const dock = page.locator('[data-component="session-plan-build-dock"]')
  await expect(dock).toBeVisible()
  await expect(dock.getByText("Plan ready")).toBeVisible()

  await dock.getByRole("button", { name: "Build" }).click()

  await expect.poll(() => prompts.length).toBe(1)
  const body = JSON.parse(prompts[0]!) as { agent?: string; parts?: unknown[] }
  expect(body.agent).toBe("build")
  expect(JSON.stringify(body.parts)).toContain("Execute the plan")
  await expect(dock).toHaveCount(0)
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
