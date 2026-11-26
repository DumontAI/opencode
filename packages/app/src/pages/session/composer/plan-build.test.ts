import { describe, expect, test } from "bun:test"
import { shouldOfferPlanBuild } from "./plan-build"

const base = {
  lastRole: "assistant" as const,
  agent: "plan",
  completed: true,
  busy: false,
  blocked: false,
  child: false,
}

describe("plan Build action", () => {
  test("offers Build after a completed plan turn", () => {
    expect(shouldOfferPlanBuild(base)).toBe(true)
  })

  test("does not offer Build while the plan is still running", () => {
    expect(shouldOfferPlanBuild({ ...base, completed: false })).toBe(false)
    expect(shouldOfferPlanBuild({ ...base, busy: true })).toBe(false)
  })

  test("does not offer Build for non-plan turns", () => {
    expect(shouldOfferPlanBuild({ ...base, agent: "build" })).toBe(false)
    expect(shouldOfferPlanBuild({ ...base, lastRole: "user" })).toBe(false)
  })

  test("does not offer Build while blocked or in a child session", () => {
    expect(shouldOfferPlanBuild({ ...base, blocked: true })).toBe(false)
    expect(shouldOfferPlanBuild({ ...base, child: true })).toBe(false)
  })
})
