import {
  DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
  EnvironmentId,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ProjectCollectionsView } from "../projects/useProjectCollections";
import {
  planGenericSharedSettingsFanout,
  planProjectCollectionsSettings,
  resolveAgentAwarenessPlatformPresentation,
} from "./SettingsRouteScreen.logic";

const referenceId = EnvironmentId.make("environment-reference");
const secondaryId = EnvironmentId.make("environment-secondary");
const offlineId = EnvironmentId.make("environment-offline");
const oldId = EnvironmentId.make("environment-old");

function view(overrides: Partial<ProjectCollectionsView> = {}): ProjectCollectionsView {
  return {
    document: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
    confirmedDocument: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
    optimisticDocument: null,
    rejectedCandidate: null,
    phase: "idle",
    status: { phase: "idle", savedCount: 1, eligibleCount: 1, message: null },
    referenceEnvironmentId: referenceId,
    referenceLabel: "MacBook Pro",
    eligibleEnvironmentIds: [referenceId],
    mismatchEnvironmentIds: [],
    canMutate: true,
    save: () => ({ ok: true, value: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT }),
    retry: () => undefined,
    useThisLayoutEverywhere: () => undefined,
    ...overrides,
  };
}

function environment(
  environmentId: EnvironmentId,
  label: string,
  options: { connected?: boolean; capable?: boolean } = {},
) {
  return {
    environmentId,
    label,
    connection: {
      phase: options.connected === false ? ("offline" as const) : ("connected" as const),
    },
    serverConfig: {
      environment: { capabilities: { projectCollections: options.capable ?? true } },
    },
  };
}

describe("resolveAgentAwarenessPlatformPresentation", () => {
  it("explains that agent awareness settings are unavailable on Android", () => {
    expect(resolveAgentAwarenessPlatformPresentation("android")).toEqual({
      supported: false,
      subtitle: "iOS only",
    });
  });

  it("leaves supported iOS settings unchanged", () => {
    expect(resolveAgentAwarenessPlatformPresentation("ios")).toEqual({
      supported: true,
      subtitle: undefined,
    });
  });
});

describe("planProjectCollectionsSettings", () => {
  it("presents the stable reference and capable drift without including offline or older environments", () => {
    const model = planProjectCollectionsSettings({
      view: view({
        phase: "partial",
        status: {
          phase: "partial",
          savedCount: 1,
          eligibleCount: 2,
          message: "Saved on 1 of 2 environments",
        },
        eligibleEnvironmentIds: [referenceId, secondaryId],
        mismatchEnvironmentIds: [referenceId, secondaryId, offlineId, oldId],
      }),
      environments: [
        environment(referenceId, "MacBook Pro"),
        environment(secondaryId, "Mac mini"),
        environment(offlineId, "Travel laptop", { connected: false }),
        environment(oldId, "Old Mac", { capable: false }),
      ],
    });

    expect(model).toMatchObject({
      availability: "available",
      referenceLabel: "MacBook Pro",
      mismatchLabels: ["Mac mini"],
      statusMessage: "Saved on 1 of 2 environments",
      showRetry: true,
      showUseThisLayoutEverywhere: true,
      actionsDisabled: false,
    });
    expect(model.statusMessage).not.toContain("Travel laptop");
    expect(model.statusMessage).not.toContain("Old Mac");
  });

  it("keeps the hook-selected reference when another capable environment reconnects", () => {
    const reconnected = environment(offlineId, "Travel laptop");
    const model = planProjectCollectionsSettings({
      view: view({
        referenceEnvironmentId: referenceId,
        referenceLabel: "MacBook Pro",
        eligibleEnvironmentIds: [offlineId, referenceId],
        mismatchEnvironmentIds: [offlineId],
      }),
      environments: [reconnected, environment(referenceId, "MacBook Pro")],
    });

    expect(model.referenceLabel).toBe("MacBook Pro");
    expect(model.mismatchLabels).toEqual(["Travel laptop"]);
  });

  it("makes an older-only state explicitly read-only", () => {
    expect(
      planProjectCollectionsSettings({
        view: view({
          document: null,
          confirmedDocument: null,
          referenceEnvironmentId: null,
          referenceLabel: null,
          eligibleEnvironmentIds: [],
          canMutate: false,
        }),
        environments: [environment(oldId, "Old Mac", { capable: false })],
      }),
    ).toMatchObject({
      availability: "older-only",
      showRetry: false,
      showUseThisLayoutEverywhere: false,
      actionsDisabled: true,
    });
  });
});

describe("generic settings planning", () => {
  it("cannot send project collections through the AutoSettle fanout", () => {
    const patch = {
      sidebarAutoSettleOnMerge: false,
      projectCollections: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
    } as ServerSettingsPatch;

    expect(
      planGenericSharedSettingsFanout({
        patch,
        targets: [{ environmentId: referenceId, capabilities: undefined, settings: undefined }],
      }),
    ).toEqual([
      {
        environmentId: referenceId,
        patch: { sidebarAutoSettleOnMerge: false },
      },
    ]);
  });

  it("plans no generic write for a dedicated-only Apply to all patch", () => {
    expect(
      planGenericSharedSettingsFanout({
        patch: { projectCollections: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT },
        targets: [{ environmentId: secondaryId, capabilities: undefined, settings: undefined }],
      }),
    ).toEqual([]);
  });
});
