import { describe, expect, it, vi } from "vite-plus/test";

import { buildHomeListFilterMenuItems } from "./home-list-filter-menu";

describe("buildHomeListFilterMenuItems", () => {
  it("adds a project scope submenu that selects and clears the same scope as the chips", () => {
    const onProjectChange = vi.fn();
    const items = buildHomeListFilterMenuItems({
      environments: [],
      projects: [
        { key: "environment-1:project-1", label: "Codething" },
        { key: "environment-1:project-2", label: "Website" },
      ],
      selectedEnvironmentId: null,
      selectedProjectKey: "environment-1:project-1",
      projectCollectionScope: { kind: "project", projectKey: "environment-1:project-1" },
      projectCollectionScopeOptions: [],
      projectCollectionsAvailable: false,
      canManageProjectCollections: false,
      onEnvironmentChange: vi.fn(),
      onProjectChange,
      onProjectCollectionScopeChange: vi.fn(),
      onManageProjectCollections: vi.fn(),
    });

    const projectMenu = items.find((item) => item.title === "Project");
    expect(items.some((item) => item.title === "Settings")).toBe(false);
    expect(projectMenu).toMatchObject({
      items: [
        { title: "All projects", selected: false },
        { title: "Codething", selected: true },
        { title: "Website", selected: false },
      ],
    });
    if (!projectMenu || !("items" in projectMenu)) throw new Error("Expected project submenu");

    projectMenu.items[0]?.onPress();
    projectMenu.items[2]?.onPress();
    expect(onProjectChange).toHaveBeenNthCalledWith(1, null);
    expect(onProjectChange).toHaveBeenNthCalledWith(2, "environment-1:project-2");
  });
});
