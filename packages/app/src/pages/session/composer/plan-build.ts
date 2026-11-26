export function shouldOfferPlanBuild(input: {
  lastRole: "user" | "assistant" | undefined
  agent: string | undefined
  completed: boolean
  busy: boolean
  blocked: boolean
  child: boolean
}) {
  return (
    input.lastRole === "assistant" &&
    input.agent === "plan" &&
    input.completed &&
    !input.busy &&
    !input.blocked &&
    !input.child
  )
}
