import { Show, createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { formatServerError } from "@/utils/server-errors"
import { showToast } from "@/utils/toast"
import { reviewRecommendation } from "./review-actions-state"

function actionMessage(error: unknown, fallback: string, translate: (key: string) => string) {
  const body = (error as { cause?: { body?: { data?: { message?: unknown } } } })?.cause?.body
  const direct = (error as { data?: { message?: unknown } })?.data
  const message = body?.data?.message ?? direct?.message
  if (typeof message === "string" && message.trim()) return message
  return formatServerError(error, translate, fallback)
}

export function ReviewActions(props: { onRepositoryChanged: () => void; sessionTitle?: string }) {
  const sdk = useSDK()
  const language = useLanguage()
  const queryClient = useQueryClient()
  const [state, setState] = createStore({
    form: undefined as "commit" | "merge" | undefined,
    message: "",
  })

  const queryKey = createMemo(() => ["review-actions", sdk().scope, sdk().directory] as const)

  const syncQuery = createQuery(() => ({
    queryKey: queryKey(),
    queryFn: async () => {
      const result = await sdk().client.vcs.sync()
      if (!result.data) throw new Error("VCS sync unavailable")
      return result.data
    },
    staleTime: 5_000,
  }))

  const status = () => syncQuery.data
  const recommendation = createMemo(() => (status() ? reviewRecommendation(status()!) : undefined))

  const refresh = useMutation(() => ({
    mutationFn: async () => {
      const result = await sdk().client.vcs.fetch()
      if (!result.data) throw new Error("VCS sync unavailable")
      return result.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey(), data)
      props.onRepositoryChanged()
    },
    onError: (error) => {
      showToast({
        variant: "error",
        title: language.t("session.review.actions.fetch.failed"),
        description: actionMessage(error, language.t("common.requestFailed"), language.t),
      })
    },
  }))

  const commit = useMutation(() => ({
    mutationFn: async (message: string) => {
      const result = await sdk().client.vcs.commit({ message })
      if (!result.data) throw new Error("VCS commit unavailable")
      return result.data
    },
    onSuccess: (data) => {
      setState({ form: undefined, message: "" })
      queryClient.invalidateQueries({ queryKey: queryKey() })
      props.onRepositoryChanged()
      showToast({
        title: language.t("session.review.actions.commit.success"),
        description: language.t("session.review.actions.commit.successDetail", { commit: data.commit }),
      })
    },
    onError: (error) => {
      showToast({
        variant: "error",
        title: language.t("session.review.actions.commit.failed"),
        description: actionMessage(error, language.t("common.requestFailed"), language.t),
      })
      queryClient.invalidateQueries({ queryKey: queryKey() })
    },
  }))

  const merge = useMutation(() => ({
    mutationFn: async (base?: string) => {
      const result = await sdk().client.vcs.merge({ base })
      if (!result.data) throw new Error("VCS merge unavailable")
      return result.data
    },
    onSuccess: (data) => {
      setState("form", undefined)
      queryClient.invalidateQueries({ queryKey: queryKey() })
      props.onRepositoryChanged()
      if (data.conflicts.length > 0) {
        showToast({
          title: language.t("session.review.actions.merge.conflicts"),
          description: language.plural("session.review.actions.merge.conflictDetail", data.conflicts.length, {
            files: data.conflicts.join(", "),
          }),
        })
        return
      }
      showToast({
        title: language.t("session.review.actions.merge.success"),
        description: language.t("session.review.actions.merge.successDetail", { base: data.base }),
      })
    },
    onError: (error) => {
      showToast({
        variant: "error",
        title: language.t("session.review.actions.merge.failed"),
        description: actionMessage(error, language.t("common.requestFailed"), language.t),
      })
      queryClient.invalidateQueries({ queryKey: queryKey() })
    },
  }))

  onMount(() => {
    void sdk()
      .client.vcs.fetch()
      .then((result) => {
        if (result.data) queryClient.setQueryData(queryKey(), result.data)
      })
      .catch(() => undefined)
  })

  const behind = createMemo(() => {
    const data = status()
    if (!data?.base || data.behind === 0) return
    return language.plural("session.review.actions.behind", data.behind, { base: data.base })
  })

  const ahead = createMemo(() => {
    const data = status()
    if (!data || data.ahead === 0) return
    return language.plural("session.review.actions.ahead", data.ahead)
  })

  const dirty = createMemo(() => {
    const data = status()
    if (!data || data.dirty === 0) return
    return language.plural("session.review.actions.dirty", data.dirty)
  })

  const recommendationText = createMemo(() => {
    const data = status()
    if (!data) return
    const base = data.base ?? ""
    switch (recommendation()) {
      case "conflicts":
        return language.t("session.review.actions.recommend.conflicts")
      case "dirtyBehind":
        return language.plural("session.review.actions.recommend.dirtyBehind", data.behind, { base })
      case "behind":
        return language.plural("session.review.actions.recommend.behind", data.behind, { base })
      case "dirty":
        return language.t("session.review.actions.recommend.dirty")
      case "ahead":
        return language.plural("session.review.actions.recommend.ahead", data.ahead)
      case "clean":
        return base
          ? language.t("session.review.actions.recommend.clean", { base })
          : language.t("session.review.actions.recommend.noBase")
    }
  })

  const commitDisabled = () => {
    const data = status()
    if (!data) return true
    return data.dirty === 0 || data.merging || data.conflicts > 0 || commit.isPending
  }

  const mergeDisabled = () => {
    const data = status()
    if (!data) return true
    return !data.base || data.behind === 0 || data.dirty > 0 || data.merging || data.conflicts > 0 || merge.isPending
  }

  const openCommit = () => {
    setState("form", "commit")
    setState("message", props.sessionTitle?.trim().slice(0, 72) ?? "")
  }

  return (
    <div data-component="review-actions" class="shrink-0 border-b border-border-weak-base">
      <div class="px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Show
          when={status()}
          fallback={<span class="text-12-regular text-text-weak">{language.t("session.review.actions.loading")}</span>}
        >
          <span class="text-12-medium text-text-strong truncate max-w-48" title={status()!.branch}>
            {status()!.branch ?? language.t("session.review.actions.detached")}
          </span>
          <Show when={behind()}>
            <span class="text-12-regular text-text-weak">{behind()}</span>
          </Show>
          <Show when={ahead()}>
            <span class="text-12-regular text-text-weak">{ahead()}</span>
          </Show>
          <Show when={dirty()}>
            <span class="text-12-regular text-text-weak">{dirty()}</span>
          </Show>
          <Show when={!behind() && !ahead() && !dirty() && status()!.base}>
            <span class="text-12-regular text-text-weak">
              {language.t("session.review.actions.upToDate", { base: status()!.base! })}
            </span>
          </Show>
        </Show>
        <div class="ml-auto flex items-center gap-1">
          <IconButton
            data-action="review-refresh"
            icon="reset"
            size="small"
            variant="ghost"
            aria-label={language.t("session.review.actions.refresh")}
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          />
          <Button
            data-action="review-commit"
            size="small"
            variant="secondary"
            disabled={commitDisabled()}
            onClick={openCommit}
          >
            {language.t("session.review.actions.commit")}
          </Button>
          <Button
            data-action="review-merge"
            size="small"
            variant="secondary"
            disabled={mergeDisabled()}
            onClick={() => setState("form", "merge")}
          >
            {language.t("session.review.actions.merge")}
          </Button>
        </div>
      </div>

      <Show when={recommendationText()}>
        <div class="px-3 pb-2 -mt-0.5">
          <span
            classList={{
              "text-12-regular": true,
              "text-text-strong": recommendation() !== "clean",
              "text-text-weak": recommendation() === "clean",
            }}
          >
            {recommendationText()}
          </span>
        </div>
      </Show>

      <Show when={state.form === "commit"}>
        <div class="px-3 pb-3 flex flex-col gap-2">
          <TextInputV2
            data-action="review-commit-message"
            class="!w-full"
            value={state.message}
            placeholder={language.t("session.review.actions.commit.placeholder")}
            onInput={(event) => setState("message", event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              if (!state.message.trim() || commit.isPending) return
              commit.mutate(state.message)
            }}
          />
          <div class="flex items-center justify-end gap-2">
            <Button
              size="small"
              variant="ghost"
              disabled={commit.isPending}
              onClick={() => setState({ form: undefined, message: "" })}
            >
              {language.t("common.cancel")}
            </Button>
            <Button
              data-action="review-commit-confirm"
              size="small"
              variant="primary"
              disabled={!state.message.trim() || commit.isPending}
              onClick={() => commit.mutate(state.message)}
            >
              {language.t("session.review.actions.commit.action")}
            </Button>
          </div>
        </div>
      </Show>

      <Show when={state.form === "merge"}>
        <div class="px-3 pb-3 flex flex-col gap-2">
          <div class="text-12-medium text-text-strong">
            {language.t("session.review.actions.merge.title", {
              base: status()?.base ?? "",
              branch: status()?.branch ?? "",
            })}
          </div>
          <div class="text-12-regular text-text-weak">{language.t("session.review.actions.merge.description")}</div>
          <div class="flex items-center justify-end gap-2">
            <Button size="small" variant="ghost" disabled={merge.isPending} onClick={() => setState("form", undefined)}>
              {language.t("common.cancel")}
            </Button>
            <Button
              data-action="review-merge-confirm"
              size="small"
              variant="primary"
              disabled={merge.isPending}
              onClick={() => merge.mutate(status()?.base)}
            >
              {language.t("session.review.actions.merge.action")}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}
