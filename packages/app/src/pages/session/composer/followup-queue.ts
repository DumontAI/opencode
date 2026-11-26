export function shouldQueueFollowup(input: {
  followup: "queue" | "steer"
  busy: boolean
  blocked: boolean
  child: boolean
}) {
  return input.followup === "queue" && input.busy && !input.blocked && !input.child
}
