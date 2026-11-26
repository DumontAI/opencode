export type ReviewRecommendation = "conflicts" | "dirtyBehind" | "behind" | "dirty" | "ahead" | "clean"

export function reviewRecommendation(input: {
  ahead: number
  behind: number
  dirty: number
  conflicts: number
  merging: boolean
}): ReviewRecommendation {
  if (input.merging || input.conflicts > 0) return "conflicts"
  if (input.dirty > 0 && input.behind > 0) return "dirtyBehind"
  if (input.behind > 0) return "behind"
  if (input.dirty > 0) return "dirty"
  if (input.ahead > 0) return "ahead"
  return "clean"
}
