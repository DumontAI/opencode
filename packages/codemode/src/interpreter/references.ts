import { ToolReference } from "../tool-runtime.js"
import { invalidData } from "./model.js"
import { Callable, getOwn, isRuntimeReference, Obj, Opaque, ownKeys } from "./objects.js"

/** Interpreter machinery that is never data, unlike a Date or Map, which cross some boundaries as copies. */
export const isOpaque = (value: unknown): boolean => value instanceof Opaque || value instanceof ToolReference

function* childValues(value: object): Generator {
  if (!(value instanceof Obj)) return
  for (const key of ownKeys(value)) yield getOwn(value, key)
}

// Depth-first search over a value tree. `match` stops the walk; `skip` prunes a subtree without matching it.
const find = (
  value: unknown,
  match: (current: unknown) => boolean,
  skip: (current: unknown) => boolean,
  seen: Set<object>,
): boolean => {
  const pending: Array<Iterator<unknown>> = [[value].values()]
  while (pending.length > 0) {
    const next = pending.at(-1)!.next()
    if (next.done) {
      pending.pop()
      continue
    }
    const current = next.value
    if (match(current)) return true
    if (current === null || typeof current !== "object" || skip(current) || seen.has(current)) continue
    seen.add(current)
    pending.push(childValues(current))
  }
  return false
}

const never = () => false

export const containsRuntimeReference = (value: unknown): boolean => find(value, isRuntimeReference, never, new Set())

export const containsOpaqueReference = (value: unknown): boolean =>
  find(value, isOpaque, (current) => isRuntimeReference(current) && !isOpaque(current), new Set())

// Reject cycles before mutation so later boundary walks remain safe.
export const rejectCircularInsertion = (
  container: object,
  value: unknown,
  label: string,
  seen = new Set<object>(),
): void => {
  if (find(value, (current) => current === container, isRuntimeReference, seen)) {
    throw invalidData(`${label} contains a circular value.`)
  }
}

export const describeValue = (value: unknown): string => {
  if (value === null || value === undefined) return String(value)
  if (value instanceof Obj) return value.describe
  if (value instanceof ToolReference) return "a tool reference"
  return `a ${typeof value}`
}

export const typeofValue = (value: unknown): string => {
  if (value instanceof Callable) return "function"
  if (value instanceof ToolReference) return value.path.length > 0 ? "function" : "object"
  return typeof value
}
