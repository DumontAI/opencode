import { describe, expect, test } from "bun:test"
import { shouldQueueFollowup } from "./followup-queue"

const base = {
  followup: "queue" as const,
  busy: true,
  blocked: false,
  child: false,
}

describe("follow-up queue gating", () => {
  test("queues in queue mode while a session is busy", () => {
    expect(shouldQueueFollowup(base)).toBe(true)
  })

  test("sends immediately in steer mode", () => {
    expect(shouldQueueFollowup({ ...base, followup: "steer" })).toBe(false)
  })

  test("does not queue while idle", () => {
    expect(shouldQueueFollowup({ ...base, busy: false })).toBe(false)
  })

  test("does not queue while a question or permission blocks the composer", () => {
    expect(shouldQueueFollowup({ ...base, blocked: true })).toBe(false)
  })

  test("does not queue in child sessions", () => {
    expect(shouldQueueFollowup({ ...base, child: true })).toBe(false)
  })
})
