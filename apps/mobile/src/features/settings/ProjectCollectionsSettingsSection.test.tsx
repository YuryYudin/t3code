import { DEFAULT_PROJECT_COLLECTIONS_DOCUMENT, EnvironmentId } from "@t3tools/contracts";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ProjectCollectionsView } from "../projects/useProjectCollections";

const boundaryRuntime = vi.hoisted(() => ({
  view: null as unknown,
  environments: [] as unknown[],
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Pressable: "native-pressable",
  View: "native-view",
}));
vi.mock("../../components/AppText", () => ({ AppText: "native-text" }));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: boundaryRuntime.environments }),
}));
vi.mock("../projects/useProjectCollections", () => ({
  useProjectCollections: () => boundaryRuntime.view,
}));

import {
  ProjectCollectionsSettingsSection,
  ProjectCollectionsSettingsSectionView,
} from "./ProjectCollectionsSettingsSection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const referenceId = EnvironmentId.make("environment-reference");
const secondaryId = EnvironmentId.make("environment-secondary");
const oldId = EnvironmentId.make("environment-old");

function view(overrides: Partial<ProjectCollectionsView> = {}): ProjectCollectionsView {
  return {
    document: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
    confirmedDocument: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
    optimisticDocument: null,
    rejectedCandidate: null,
    phase: "idle",
    status: { phase: "idle", savedCount: 2, eligibleCount: 2, message: null },
    referenceEnvironmentId: referenceId,
    referenceLabel: "MacBook Pro",
    eligibleEnvironmentIds: [referenceId, secondaryId],
    mismatchEnvironmentIds: [],
    canMutate: true,
    save: () => ({ ok: true, value: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT }),
    retry: vi.fn(),
    useThisLayoutEverywhere: vi.fn(),
    ...overrides,
  };
}

function environment(environmentId: EnvironmentId, label: string, capable = true) {
  return {
    environmentId,
    label,
    connection: { phase: "connected" as const },
    serverConfig: { environment: { capabilities: { projectCollections: capable } } },
  };
}

let renderer: ReactTestRenderer | undefined;

function render(
  currentView: ProjectCollectionsView,
  environments = [environment(referenceId, "MacBook Pro"), environment(secondaryId, "Mac mini")],
) {
  act(() => {
    renderer = create(
      <ProjectCollectionsSettingsSectionView view={currentView} environments={environments} />,
    );
  });
  return renderer!.root;
}

function text(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(text).join("");
}

function button(label: string): ReactTestInstance {
  const match = renderer!.root
    .findAll((candidate) => String(candidate.type) === "native-pressable")
    .find((candidate) => text(candidate).trim() === label);
  if (!match) throw new Error(`Missing button ${label}`);
  return match;
}

function byTestId(testID: string): ReactTestInstance {
  return renderer!.root.findByProps({ testID });
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  boundaryRuntime.view = null;
  boundaryRuntime.environments = [];
});

describe("ProjectCollectionsSettingsSection", () => {
  it("shows the reference and mismatch labels and uses the acknowledged reconciliation action", () => {
    const current = view({
      phase: "partial",
      status: {
        phase: "partial",
        savedCount: 1,
        eligibleCount: 2,
        message: "Saved on 1 of 2 environments",
      },
      mismatchEnvironmentIds: [secondaryId],
    });
    const root = render(current);

    expect(text(root)).toContain("Reference layout");
    expect(text(root)).toContain("MacBook Pro");
    expect(text(root)).toContain("Saved on 1 of 2 environments");
    expect(text(root)).toContain("Mac mini");
    expect(button("Retry failed saves").props.testID).toBe("retry-cross-sync");
    expect(button("Use this layout everywhere").props.testID).toBe("apply-cross-layout");

    act(() => button("Use this layout everywhere").props.onPress());
    expect(current.useThisLayoutEverywhere).toHaveBeenCalledOnce();
    expect(current.retry).not.toHaveBeenCalled();
  });

  it("disables reconciliation while an acknowledged save is in flight", () => {
    render(
      view({
        phase: "saving-reference",
        referenceLabel: "MacBook Pro",
        mismatchEnvironmentIds: [secondaryId],
        canMutate: false,
      }),
    );

    expect(text(renderer!.root)).toContain("Saving to MacBook Pro");
    expect(button("Use this layout everywhere").props).toMatchObject({
      disabled: true,
      accessibilityState: { disabled: true },
    });
  });

  it("offers retry after a rejected reference write", () => {
    const current = view({
      phase: "not-saved",
      status: { phase: "not-saved", savedCount: 0, eligibleCount: 2, message: "Not saved" },
      rejectedCandidate: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
    });
    render(current);

    expect(text(renderer!.root)).toContain("Your attempted layout is ready to retry");
    expect(button("Retry save").props.testID).toBe("retry-reference-write");
    act(() => button("Retry save").props.onPress());
    expect(current.retry).toHaveBeenCalledOnce();
  });

  it("mounts the public wrapper against the acknowledged collection hook", () => {
    const current = view({
      phase: "partial",
      status: {
        phase: "partial",
        savedCount: 1,
        eligibleCount: 2,
        message: "Saved on 1 of 2 environments",
      },
      mismatchEnvironmentIds: [secondaryId],
    });
    boundaryRuntime.view = current;
    boundaryRuntime.environments = [
      environment(referenceId, "MacBook Pro"),
      environment(secondaryId, "Mac mini"),
    ];

    act(() => {
      renderer = create(<ProjectCollectionsSettingsSection />);
    });

    expect(text(renderer!.root)).toContain("Reference layout");
    expect(text(renderer!.root)).toContain("MacBook Pro");
    expect(text(renderer!.root)).toContain("Mac mini");
    act(() => byTestId("apply-cross-layout").props.onPress());
    expect(current.useThisLayoutEverywhere).toHaveBeenCalledOnce();
  });

  it("shows older-only guidance without collection mutation controls", () => {
    const root = render(
      view({
        document: null,
        confirmedDocument: null,
        referenceEnvironmentId: null,
        referenceLabel: null,
        eligibleEnvironmentIds: [],
        canMutate: false,
      }),
      [environment(oldId, "Old Mac", false)],
    );

    expect(text(root)).toContain("Collections need a newer server");
    expect(text(root)).toContain("You can still open projects and threads");
    expect(
      renderer!.root.findAll((candidate) => String(candidate.type) === "native-pressable"),
    ).toHaveLength(0);
  });
});
