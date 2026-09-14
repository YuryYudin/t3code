import type { MenuAction } from "@react-native-menu/menu";
import { HeaderHeightContext } from "@react-navigation/elements";
import { useCallback, useContext, useMemo } from "react";
import { Platform, Pressable, ScrollView, Text as RNText, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { ControlPillMenu } from "../../components/ControlPill";
import { ProjectCollectionIcon } from "../../components/ProjectCollectionIcon";
import { IOS_NAV_BAR_HEIGHT } from "../../lib/layoutMetrics";
import type { HomeHeaderProps } from "./HomeHeader.types";
import { mobileProjectCollectionScopeKey } from "./mobileProjectCollections";

/**
 * Horizontal collection filter pills plus the "add project or collection"
 * menu. Rendered under the navigation bar by both the iOS and the Android home
 * headers, which upstream keeps in separate platform files.
 */
export function ProjectCollectionScopeStrip(props: HomeHeaderProps) {
  const insets = useSafeAreaInsets();
  const navigationHeaderHeight = useContext(HeaderHeightContext);
  const addActions = useMemo<MenuAction[]>(
    () => [
      { id: "add:project", title: "New project" },
      ...(props.canManageProjectCollections
        ? [
            { id: "add:collection", title: "New collection" },
            { id: "add:manage", title: "Manage collections" },
          ]
        : []),
    ],
    [props.canManageProjectCollections],
  );
  const handleAddAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      if (nativeEvent.event === "add:project") {
        props.onStartNewProject();
      } else if (nativeEvent.event === "add:collection" || nativeEvent.event === "add:manage") {
        props.onManageProjectCollections();
      }
    },
    [props.onManageProjectCollections, props.onStartNewProject],
  );

  return (
    <View
      testID="project-collection-scope-strip"
      className="flex-row items-center gap-2 px-4 py-2"
      // The native iOS navigation bar is translucent, so content begins behind
      // it. Prefer the navigator's measured height and retain a safe fallback
      // for previews and tests outside a header-providing screen.
      style={
        Platform.OS === "ios"
          ? { paddingTop: (navigationHeaderHeight || insets.top + IOS_NAV_BAR_HEIGHT) + 8 }
          : undefined
      }
    >
      {props.projectCollectionsAvailable ? (
        <ScrollView
          horizontal
          className="min-w-0 flex-1"
          contentContainerClassName="gap-2"
          showsHorizontalScrollIndicator={false}
        >
          {props.projectCollectionScopeOptions.map((option) => {
            const selected =
              mobileProjectCollectionScopeKey(option.scope) ===
              mobileProjectCollectionScopeKey(props.projectCollectionScope);
            return (
              <Pressable
                key={mobileProjectCollectionScopeKey(option.scope)}
                accessibilityLabel={`Show ${option.label}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                className={
                  selected
                    ? "h-10 flex-row items-center gap-2 rounded-full bg-primary px-3"
                    : "h-10 flex-row items-center gap-2 rounded-full bg-subtle px-3"
                }
                onPress={() => props.onProjectCollectionScopeChange(option.scope)}
              >
                {option.collection ? (
                  <ProjectCollectionIcon size={16} visual={option.collection.visual} />
                ) : (
                  <SymbolView
                    // Upstream's symbol type only allows SF symbols with an
                    // Android mapping; "tray" has none, so name both halves.
                    name={
                      option.scope.kind === "unfiled"
                        ? { ios: "tray", android: "folder_open" }
                        : "square.grid.2x2"
                    }
                    size={15}
                    tintColorClassName={selected ? "accent-primary-foreground" : "accent-icon"}
                    type="monochrome"
                  />
                )}
                <RNText
                  className={
                    selected
                      ? "text-xs font-t3-bold text-primary-foreground"
                      : "text-xs font-t3-bold text-foreground"
                  }
                >
                  {option.label} · {option.count}
                </RNText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <View className="flex-1" />
      )}
      <ControlPillMenu actions={addActions} isAnchoredToRight onPressAction={handleAddAction}>
        <Pressable
          accessibilityLabel="Add project or collection"
          accessibilityRole="button"
          className="size-10 items-center justify-center rounded-full bg-subtle"
        >
          <SymbolView name="plus" size={17} tintColorClassName="accent-icon" type="monochrome" />
        </Pressable>
      </ControlPillMenu>
    </View>
  );
}
