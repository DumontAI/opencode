import { describe, expect, test } from "bun:test"
import { reviewRecommendation } from "./review-actions-state"

const clean = { ahead: 0, behind: 0, dirty: 0, conflicts: 0, merging: false }

describe("review recommendation", () => {
  test("asks for conflict resolution first", () => {
    expect(reviewRecommendation({ ...clean, merging: true, conflicts: 2, dirty: 1, behind: 3 })).toBe("conflicts")
    expect(reviewRecommendation({ ...clean, conflicts: 1, behind: 2 })).toBe("conflicts")
  })

  test("asks to commit before merging when both apply", () => {
    expect(reviewRecommendation({ ...clean, dirty: 2, behind: 3 })).toBe("dirtyBehind")
  })

  test("asks to merge when only behind", () => {
    expect(reviewRecommendation({ ...clean, behind: 3 })).toBe("behind")
  })

  test("asks to commit when only dirty", () => {
    expect(reviewRecommendation({ ...clean, dirty: 2 })).toBe("dirty")
  })

  test("reports unpushed commits and clean state", () => {
    expect(reviewRecommendation({ ...clean, ahead: 2 })).toBe("ahead")
    expect(reviewRecommendation(clean)).toBe("clean")
  })
})
