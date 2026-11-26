import { Button } from "@opencode-ai/ui/button"
import { DockTray } from "@opencode-ai/ui/dock-surface"
import { useLanguage } from "@/context/language"

export function SessionPlanBuildDock(props: { onBuild: () => void; disabled?: boolean }) {
  const language = useLanguage()

  return (
    <DockTray
      data-component="session-plan-build-dock"
      style={{
        "margin-bottom": "-0.875rem",
        "border-bottom-left-radius": 0,
        "border-bottom-right-radius": 0,
      }}
    >
      <div class="pl-3 pr-2 py-2 flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-13-medium text-text-strong">{language.t("session.planBuild.title")}</div>
          <div class="text-12-regular text-text-weak">{language.t("session.planBuild.description")}</div>
        </div>
        <Button
          data-action="session-plan-build"
          size="small"
          variant="primary"
          disabled={props.disabled}
          onClick={props.onBuild}
        >
          {language.t("session.planBuild.action")}
        </Button>
      </div>
    </DockTray>
  )
}
