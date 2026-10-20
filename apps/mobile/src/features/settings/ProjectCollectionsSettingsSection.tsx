import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useEnvironments } from "../../state/environments";
import {
  useProjectCollections,
  type ProjectCollectionsView,
} from "../projects/useProjectCollections";
import {
  planProjectCollectionsSettings,
  type ProjectCollectionsSettingsEnvironment,
} from "./SettingsRouteScreen.logic";
import { SettingsSection } from "./components/SettingsSection";

function Action(props: {
  readonly label: string;
  readonly testID: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={props.label}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      className="min-h-[48px] items-center justify-center rounded-2xl border border-secondary-border bg-secondary px-4 py-3 disabled:opacity-[0.45]"
      disabled={props.disabled}
      onPress={props.onPress}
      testID={props.testID}
    >
      <Text className="text-sm font-t3-bold text-secondary-foreground">{props.label}</Text>
    </Pressable>
  );
}

export function ProjectCollectionsSettingsSectionView(props: {
  readonly view: ProjectCollectionsView;
  readonly environments: ReadonlyArray<ProjectCollectionsSettingsEnvironment>;
}) {
  const model = planProjectCollectionsSettings(props);

  if (model.availability !== "available") {
    const olderOnly = model.availability === "older-only";
    return (
      <SettingsSection title="Project collections">
        <View className="gap-1 p-4" testID="project-collections-read-only">
          <Text className="text-lg text-foreground">
            {olderOnly ? "Collections need a newer server" : "Collections unavailable"}
          </Text>
          <Text className="text-sm leading-normal text-foreground-muted">
            {olderOnly
              ? "You can still open projects and threads. Update an environment to organize collections."
              : "Connect an environment that supports collections to view and organize your layout."}
          </Text>
        </View>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Project collections">
      <View className="gap-1 p-4" testID="project-collections-reference">
        <Text className="text-lg text-foreground">Reference layout</Text>
        <Text className="text-sm text-foreground-muted">
          {model.referenceLabel ?? "Connected environment"}
        </Text>
      </View>
      {model.statusMessage !== null || model.mismatchLabels.length > 0 ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole={props.view.phase === "not-saved" ? "alert" : undefined}
          className="gap-1 border-t border-border-subtle p-4"
          testID="project-collections-sync-status"
        >
          {model.statusMessage !== null ? (
            <Text className="text-base font-t3-medium text-foreground">{model.statusMessage}</Text>
          ) : null}
          {model.mismatchLabels.length > 0 ? (
            <Text className="text-sm text-foreground-muted">
              Different layout: {model.mismatchLabels.join(", ")}
            </Text>
          ) : null}
          {model.statusDescription !== null ? (
            <Text className="text-sm leading-normal text-foreground-muted">
              {model.statusDescription}
            </Text>
          ) : null}
        </View>
      ) : null}
      {model.showRetry || model.showUseThisLayoutEverywhere ? (
        <View className="gap-2 border-t border-border-subtle p-4">
          {model.showRetry ? (
            <Action
              disabled={model.actionsDisabled}
              label={props.view.phase === "not-saved" ? "Retry save" : "Retry failed saves"}
              onPress={props.view.retry}
              testID={
                props.view.phase === "not-saved" ? "retry-reference-write" : "retry-cross-sync"
              }
            />
          ) : null}
          {model.showUseThisLayoutEverywhere ? (
            <Action
              disabled={model.actionsDisabled}
              label="Use this layout everywhere"
              onPress={props.view.useThisLayoutEverywhere}
              testID="apply-cross-layout"
            />
          ) : null}
        </View>
      ) : null}
    </SettingsSection>
  );
}

export function ProjectCollectionsSettingsSection() {
  const view = useProjectCollections();
  const { environments } = useEnvironments();
  return <ProjectCollectionsSettingsSectionView view={view} environments={environments} />;
}
