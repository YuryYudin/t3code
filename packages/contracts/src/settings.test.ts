import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { type CommandId, ProjectId } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import {
  ClientSettingsSchema,
  ClientSettingsPatch,
  ClaudeSettings,
  DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
  DEFAULT_SERVER_SETTINGS,
  MAX_PROJECT_COLLECTION_ASSIGNMENTS,
  MAX_PROJECT_COLLECTION_DOCUMENT_BYTES,
  MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH,
  MAX_PROJECT_COLLECTIONS,
  normalizeProjectCollectionName,
  PROJECT_COLLECTION_ICON_NAMES,
  ProjectCollection,
  ProjectCollectionAssignment,
  ProjectCollectionId,
  ProjectCollectionProjectKey,
  ProjectCollectionsDocument,
  requiredScopesForProjectMutation,
  resolveIdleCompaction,
  resolveProjectProviderInstanceEnabled,
  resolveProviderInstanceEnabled,
  ServerSettings,
  ServerSettingsPatch,
} from "./settings.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);
const encodeClientSettings = Schema.encodeSync(ClientSettingsSchema);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeServerSettings = Schema.encodeSync(ServerSettings);
const decodeClaudeSettings = Schema.decodeUnknownSync(ClaudeSettings);
const decodeProjectCollectionsDocument = Schema.decodeUnknownSync(ProjectCollectionsDocument);
const encodeProjectCollectionsDocument = Schema.encodeSync(ProjectCollectionsDocument);

describe("ServerSettings project collections", () => {
  it("defaults legacy settings to an empty version-1 document and round-trips a collection", () => {
    expect(decodeServerSettings({}).projectCollections).toEqual(
      DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
    );

    const projectCollections = decodeProjectCollectionsDocument({
      schemaVersion: 1,
      collections: [
        {
          id: "c65373e8-36f4-4eca-8b3a-5d8edf14c9cb",
          name: "  Work  ",
          visual: { kind: "lucide", name: "briefcase", color: "blue" },
        },
      ],
      assignments: [
        {
          projectKey: "github.com/t3tools/t3code",
          collectionId: "c65373e8-36f4-4eca-8b3a-5d8edf14c9cb",
        },
      ],
    });

    expect(projectCollections.collections[0]?.name).toBe("Work");
    expect(
      encodeServerSettings({ ...DEFAULT_SERVER_SETTINGS, projectCollections }).projectCollections,
    ).toEqual(projectCollections);
    expect(decodeServerSettingsPatch({ projectCollections }).projectCollections).toEqual(
      projectCollections,
    );
  });

  it("uses the exact bounded icon vocabulary and accepts one emoji grapheme", () => {
    expect(PROJECT_COLLECTION_ICON_NAMES).toEqual([
      "briefcase",
      "home",
      "folder-code",
      "code-2",
      "terminal",
      "globe-2",
      "server",
      "database",
      "bot",
      "sparkles",
      "smartphone",
      "monitor",
      "cloud-cog",
      "package",
      "book-open",
      "flask-conical",
      "shield-check",
      "rocket",
      "gamepad-2",
      "music",
      "image",
      "shopping-bag",
      "layers",
      "star",
    ]);
    expect(new Set(PROJECT_COLLECTION_ICON_NAMES).size).toBe(24);

    const withVisual = (visual: unknown) => ({
      schemaVersion: 1,
      collections: [
        {
          id: "c65373e8-36f4-4eca-8b3a-5d8edf14c9cb",
          name: "Work",
          visual,
        },
      ],
      assignments: [],
    });

    for (const name of PROJECT_COLLECTION_ICON_NAMES) {
      expect(
        decodeProjectCollectionsDocument(withVisual({ kind: "lucide", name, color: "blue" })),
      ).toBeDefined();
    }
    for (const color of [
      "gray",
      "red",
      "orange",
      "amber",
      "yellow",
      "lime",
      "green",
      "emerald",
      "teal",
      "cyan",
      "sky",
      "blue",
      "indigo",
      "violet",
      "purple",
      "fuchsia",
      "pink",
      "rose",
    ]) {
      expect(
        decodeProjectCollectionsDocument(withVisual({ kind: "lucide", name: "briefcase", color })),
      ).toBeDefined();
    }
    for (const emoji of ["👩🏽‍💻", "🇬🇧", "1️⃣"]) {
      expect(decodeProjectCollectionsDocument(withVisual({ kind: "emoji", emoji }))).toBeDefined();
    }
    for (const visual of [
      { kind: "lucide", name: "alarm-clock", color: "blue" },
      { kind: "lucide", name: "briefcase", color: "chartreuse" },
      { kind: "emoji", emoji: "not emoji" },
      { kind: "emoji", emoji: "🚀✨" },
      { kind: "emoji", emoji: `😀${"\uFE0F".repeat(31)}` },
    ]) {
      expect(() => decodeProjectCollectionsDocument(withVisual(visual))).toThrow();
    }
  });

  it("validates emoji without Intl.Segmenter", () => {
    const segmenterDescriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter");
    Object.defineProperty(Intl, "Segmenter", { configurable: true, value: undefined });
    const withEmoji = (emoji: string) => ({
      schemaVersion: 1,
      collections: [
        {
          id: "c65373e8-36f4-4eca-8b3a-5d8edf14c9cb",
          name: "Work",
          visual: { kind: "emoji", emoji },
        },
      ],
      assignments: [],
    });

    try {
      for (const emoji of ["👩🏽‍💻", "🇬🇧", "1️⃣"]) {
        expect(decodeProjectCollectionsDocument(withEmoji(emoji))).toBeDefined();
      }
      for (const emoji of ["not emoji", "🚀✨", "🚀\u200d", "🏽"]) {
        expect(() => decodeProjectCollectionsDocument(withEmoji(emoji))).toThrow();
      }
    } finally {
      if (segmenterDescriptor) Object.defineProperty(Intl, "Segmenter", segmenterDescriptor);
    }
  });

  it("trims names and enforces Unicode code-point and reserved-name bounds", () => {
    const withName = (name: string) => ({
      schemaVersion: 1,
      collections: [
        {
          id: "c65373e8-36f4-4eca-8b3a-5d8edf14c9cb",
          name,
          visual: { kind: "lucide", name: "home", color: "violet" },
        },
      ],
      assignments: [],
    });

    expect(
      decodeProjectCollectionsDocument(withName(`  ${"🚀".repeat(80)}  `)).collections[0]?.name,
    ).toBe("🚀".repeat(80));
    for (const name of ["", "   ", "a".repeat(81), "All Projects", " unFILEd "]) {
      expect(() => decodeProjectCollectionsDocument(withName(name))).toThrow();
    }
  });

  it("rejects duplicate identities and names plus dangling assignments", () => {
    const work = {
      id: "c65373e8-36f4-4eca-8b3a-5d8edf14c9cb",
      name: "Café",
      visual: { kind: "lucide", name: "briefcase", color: "blue" },
    };
    const personal = {
      id: "8d34b312-58d0-49da-aa2c-653d188a10de",
      name: "Personal",
      visual: { kind: "emoji", emoji: "🏡" },
    };
    const base = {
      schemaVersion: 1,
      collections: [work, personal],
      assignments: [
        { projectKey: "github.com/acme/app", collectionId: work.id },
        { projectKey: "github.com/acme/site", collectionId: personal.id },
      ],
    };

    for (const document of [
      { ...base, collections: [work, { ...personal, id: work.id }] },
      { ...base, collections: [work, { ...personal, name: "  CAFE\u0301  " }] },
      {
        ...base,
        assignments: [
          base.assignments[0],
          { ...base.assignments[1], projectKey: " github.com/acme/app " },
        ],
      },
      {
        ...base,
        assignments: [
          {
            projectKey: "github.com/acme/app",
            collectionId: "e268d160-2953-44c6-b744-3f041aae69a3",
          },
        ],
      },
    ]) {
      expect(() => decodeProjectCollectionsDocument(document)).toThrow();
    }
  });

  it("keys collection names with trim, NFKC, and JavaScript lowercase", () => {
    const duplicateNames = (left: string, right: string) => ({
      schemaVersion: 1,
      collections: [
        {
          id: "c65373e8-36f4-4eca-8b3a-5d8edf14c9cb",
          name: left,
          visual: { kind: "lucide", name: "briefcase", color: "blue" },
        },
        {
          id: "8d34b312-58d0-49da-aa2c-653d188a10de",
          name: right,
          visual: { kind: "lucide", name: "home", color: "green" },
        },
      ],
      assignments: [],
    });

    expect(normalizeProjectCollectionName("  Ｗｏｒｋ  ")).toBe("work");
    expect(normalizeProjectCollectionName("I")).toBe("i");
    expect(normalizeProjectCollectionName("ı")).toBe("ı");

    expect(() => decodeProjectCollectionsDocument(duplicateNames("Work", "wORK"))).toThrow();
    expect(() => decodeProjectCollectionsDocument(duplicateNames("Ｗｏｒｋ", "Work"))).toThrow();

    expect(
      decodeProjectCollectionsDocument(duplicateNames("I", "ı")).collections.map(
        (collection) => collection.name,
      ),
    ).toEqual(["I", "ı"]);
    expect(
      decodeProjectCollectionsDocument(duplicateNames("ΟΣ", "οσ")).collections.map(
        (collection) => collection.name,
      ),
    ).toEqual(["ΟΣ", "οσ"]);
    expect(
      decodeProjectCollectionsDocument(duplicateNames("Straße", "STRASSE")).collections.map(
        (collection) => collection.name,
      ),
    ).toEqual(["Straße", "STRASSE"]);
  });

  it("canonicalizes UUID case before duplicate and assignment checks", () => {
    const collectionId = "c65373e8-36f4-4eca-8b3a-5d8edf14c9cb";
    const upperCollectionId = collectionId.toUpperCase();
    const collection = {
      id: upperCollectionId,
      name: "Work",
      visual: { kind: "emoji", emoji: "💼" },
    };

    const decoded = decodeProjectCollectionsDocument({
      schemaVersion: 1,
      collections: [collection],
      assignments: [{ projectKey: "github.com/acme/app", collectionId }],
    });
    expect(decoded.collections[0]?.id).toBe(collectionId);
    expect(decoded.assignments[0]?.collectionId).toBe(collectionId);

    expect(() =>
      decodeProjectCollectionsDocument({
        schemaVersion: 1,
        collections: [collection, { ...collection, id: collectionId, name: "Personal" }],
        assignments: [],
      }),
    ).toThrow();
  });

  it("rejects encoded collection IDs that become duplicates after lowercasing", () => {
    const collectionId = "c65373e8-36f4-4eca-8b3a-5d8edf14c9cb";
    const collection = (id: string, name: string) =>
      ProjectCollection.make({
        id: ProjectCollectionId.make(id),
        name,
        visual: { kind: "lucide", name: "briefcase", color: "blue" },
      });

    expect(() =>
      encodeProjectCollectionsDocument({
        schemaVersion: 1,
        collections: [
          collection(collectionId, "Work"),
          collection(collectionId.toUpperCase(), "Personal"),
        ],
        assignments: [],
      }),
    ).toThrow();
  });

  it("rejects encoded project keys that become duplicates after trimming", () => {
    const collectionId = ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb");
    const assignment = (projectKey: string) =>
      ProjectCollectionAssignment.make({
        projectKey: ProjectCollectionProjectKey.make(projectKey),
        collectionId,
      });

    expect(() =>
      encodeProjectCollectionsDocument({
        schemaVersion: 1,
        collections: [
          ProjectCollection.make({
            id: collectionId,
            name: "Work",
            visual: { kind: "lucide", name: "briefcase", color: "blue" },
          }),
        ],
        assignments: [assignment("github.com/acme/app"), assignment(" github.com/acme/app ")],
      }),
    ).toThrow();
  });

  it("encodes mixed-case assignment references to a valid canonical document", () => {
    const collectionId = "c65373e8-36f4-4eca-8b3a-5d8edf14c9cb";
    const encoded = encodeProjectCollectionsDocument({
      schemaVersion: 1,
      collections: [
        ProjectCollection.make({
          id: ProjectCollectionId.make(collectionId),
          name: "Work",
          visual: { kind: "lucide", name: "briefcase", color: "blue" },
        }),
      ],
      assignments: [
        ProjectCollectionAssignment.make({
          projectKey: ProjectCollectionProjectKey.make(" github.com/acme/app "),
          collectionId: ProjectCollectionId.make(collectionId.toUpperCase()),
        }),
      ],
    });

    expect(encoded).toMatchObject({
      collections: [{ id: collectionId }],
      assignments: [{ projectKey: "github.com/acme/app", collectionId }],
    });
    expect(decodeProjectCollectionsDocument(encoded)).toEqual(encoded);
  });

  it("requires UUID collection identity and retains stable stale project keys", () => {
    const collectionId = "c65373e8-36f4-4eca-8b3a-5d8edf14c9cb";
    const document = {
      schemaVersion: 1,
      collections: [
        {
          id: collectionId,
          name: "Work",
          visual: { kind: "emoji", emoji: "💼" },
        },
      ],
      assignments: [{ projectKey: "github.com/offline/repository", collectionId }],
    };

    expect(decodeProjectCollectionsDocument(document).assignments).toEqual(document.assignments);
    expect(decodeServerSettingsPatch({}).projectCollections).toBeUndefined();
    expect(() =>
      decodeProjectCollectionsDocument({
        ...document,
        collections: [{ ...document.collections[0], id: "environment-local-project-id" }],
      }),
    ).toThrow();
    expect(() => decodeProjectCollectionsDocument({ ...document, schemaVersion: 2 })).toThrow();
  });

  it("bounds collection, assignment, and stable project-key dimensions", () => {
    const collection = (index: number) => ({
      id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
      name: `Collection ${index}`,
      visual: { kind: "lucide", name: "folder-code", color: "green" },
    });
    const collections = Array.from({ length: MAX_PROJECT_COLLECTIONS }, (_, index) =>
      collection(index),
    );
    expect(
      decodeProjectCollectionsDocument({ schemaVersion: 1, collections, assignments: [] })
        .collections,
    ).toHaveLength(MAX_PROJECT_COLLECTIONS);
    expect(() =>
      decodeProjectCollectionsDocument({
        schemaVersion: 1,
        collections: [...collections, collection(MAX_PROJECT_COLLECTIONS)],
        assignments: [],
      }),
    ).toThrow();

    const assignments = Array.from({ length: MAX_PROJECT_COLLECTION_ASSIGNMENTS }, (_, index) => ({
      projectKey: `repository/${index}`,
      collectionId: collections[0]!.id,
    }));
    expect(
      decodeProjectCollectionsDocument({
        schemaVersion: 1,
        collections: [collections[0]],
        assignments,
      }).assignments,
    ).toHaveLength(MAX_PROJECT_COLLECTION_ASSIGNMENTS);
    expect(() =>
      decodeProjectCollectionsDocument({
        schemaVersion: 1,
        collections: [collections[0]],
        assignments: [
          ...assignments,
          { projectKey: "one-too-many", collectionId: collections[0]!.id },
        ],
      }),
    ).toThrow();

    const projectKey = "x".repeat(MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH);
    expect(
      decodeProjectCollectionsDocument({
        schemaVersion: 1,
        collections: [collections[0]],
        assignments: [{ projectKey, collectionId: collections[0]!.id }],
      }).assignments[0]?.projectKey,
    ).toBe(projectKey);
    expect(() =>
      decodeProjectCollectionsDocument({
        schemaVersion: 1,
        collections: [collections[0]],
        assignments: [{ projectKey: `${projectKey}x`, collectionId: collections[0]!.id }],
      }),
    ).toThrow();
  });

  it("rejects a document larger than 512 KiB of UTF-8 JSON", () => {
    expect(MAX_PROJECT_COLLECTION_DOCUMENT_BYTES).toBe(512 * 1024);
    const collectionId = "c65373e8-36f4-4eca-8b3a-5d8edf14c9cb";
    const document = {
      schemaVersion: 1,
      collections: [
        {
          id: collectionId,
          name: "Work",
          visual: { kind: "lucide", name: "briefcase", color: "blue" },
        },
      ],
      assignments: Array.from({ length: 1_024 }, (_, index) => ({
        projectKey: `${index}/`.padEnd(512, "x"),
        collectionId,
      })),
    };

    expect(new TextEncoder().encode(JSON.stringify(document)).byteLength).toBeGreaterThan(
      MAX_PROJECT_COLLECTION_DOCUMENT_BYTES,
    );
    expect(() => decodeProjectCollectionsDocument(document)).toThrow();
    expect(() => decodeServerSettingsPatch({ projectCollections: document })).toThrow();
  });

  it("measures document bytes before trimming strings or stripping unknown keys", () => {
    const base = {
      schemaVersion: 1,
      collections: [
        {
          id: "c65373e8-36f4-4eca-8b3a-5d8edf14c9cb",
          name: "Work",
          visual: { kind: "lucide", name: "briefcase", color: "blue" },
        },
      ],
      assignments: [],
    };
    const oversizedWhitespace = {
      ...base,
      collections: [
        {
          ...base.collections[0],
          name: `${" ".repeat(MAX_PROJECT_COLLECTION_DOCUMENT_BYTES)}Work`,
        },
      ],
    };
    const oversizedUnknownProperty = {
      ...base,
      ignored: "x".repeat(MAX_PROJECT_COLLECTION_DOCUMENT_BYTES),
    };

    expect(() => decodeProjectCollectionsDocument(oversizedWhitespace)).toThrow();
    expect(() => decodeProjectCollectionsDocument(oversizedUnknownProperty)).toThrow();
  });
});

describe("storage cleanup settings", () => {
  it("keeps cleanup disabled for existing installations", () => {
    expect(decodeServerSettings({}).worktreeCleanup).toBeNull();
    expect(decodeServerSettings({}).storageCleanup).toEqual({
      worktreeAfterDays: null,
      worktreeSettledAfterDays: null,
      worktreeOnMerge: false,
      worktreeOnDelete: false,
      worktreeUnchanged: false,
      worktreeKeepWhen: "uncommitted-changes",
      browserArtifactsAfterDays: null,
      logsAfterDays: null,
    });
  });

  it("accepts partial custom patches but requires complete stored project rules", () => {
    expect(
      decodeServerSettingsPatch({
        worktreeCleanup: { mode: "custom", rules: { worktreeAfterDays: 8 } },
      }),
    ).toEqual({ worktreeCleanup: { mode: "custom", rules: { worktreeAfterDays: 8 } } });
    expect(() =>
      decodeServerSettings({
        projectSettingsOverrides: {
          project: { worktreeCleanup: { mode: "custom", rules: { worktreeAfterDays: 8 } } },
        },
      }),
    ).toThrow();
    expect(
      decodeServerSettings({
        projectSettingsOverrides: {
          project: {
            worktreeCleanup: {
              mode: "custom",
              rules: {
                worktreeAfterDays: null,
                worktreeOnMerge: false,
                worktreeOnDelete: false,
                worktreeUnchanged: false,
              },
            },
          },
        },
      }).projectSettingsOverrides[ProjectId.make("project")]?.worktreeCleanup,
    ).toMatchObject({
      mode: "custom",
      rules: { worktreeSettledAfterDays: null, worktreeKeepWhen: "uncommitted-changes" },
    });
  });

  it("decodes older custom rules with the default local-file policy", () => {
    const settings = decodeServerSettings({
      worktreeCleanup: {
        mode: "custom",
        rules: {
          worktreeAfterDays: 8,
          worktreeOnMerge: false,
          worktreeOnDelete: false,
          worktreeUnchanged: false,
        },
      },
    });
    expect(settings.worktreeCleanup).toMatchObject({
      rules: { worktreeKeepWhen: "uncommitted-changes" },
    });
    expect(
      decodeServerSettingsPatch({ storageCleanup: { worktreeKeepWhen: "tracked-changes" } }),
    ).toEqual({ storageCleanup: { worktreeKeepWhen: "tracked-changes" } });
    expect(() =>
      decodeServerSettingsPatch({ storageCleanup: { worktreeKeepWhen: "unknown" } }),
    ).toThrow();
  });
});

describe("ServerSettings usage price overrides", () => {
  const prices = { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 };

  it("rejects empty model IDs and incomplete input/output pricing", () => {
    for (const usagePriceOverrides of [
      { " ": prices },
      { "example-model": { inputCostPerMillionTokens: 2 } },
      { "example-model": { outputCostPerMillionTokens: 8 } },
    ]) {
      expect(() => decodeServerSettingsPatch({ usagePriceOverrides })).toThrow();
    }
  });
});

describe("custom model settings", () => {
  const capabilities = {
    optionDescriptors: [
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [{ id: "high", label: "High", isDefault: true }],
      },
    ],
  };

  it("accepts legacy bare slugs alongside full entries", () => {
    const decoded = decodeClaudeSettings({
      customModels: ["bare-slug", { slug: "named", name: "Named", capabilities }],
    });
    expect(decoded.customModels).toEqual([
      "bare-slug",
      { slug: "named", name: "Named", capabilities },
    ]);
  });
});

describe("resolveIdleCompaction", () => {
  it("lets a Claude instance override the global default", () => {
    const settings = decodeServerSettings({
      compactIdleThreads: "off",
      providerInstances: {
        claude_work: { driver: "claudeAgent", config: { idleCompaction: "onReturn" } },
        claude_personal: { driver: "claudeAgent" },
      },
    });
    expect(resolveIdleCompaction(settings, ProviderInstanceId.make("claude_work"))).toBe(
      "onReturn",
    );
    expect(resolveIdleCompaction(settings, ProviderInstanceId.make("claude_personal"))).toBe("off");
    expect(resolveIdleCompaction(settings, ProviderInstanceId.make("claudeAgent"))).toBe("off");
  });

  it("keeps the legacy beta switch's behavior", () => {
    expect(decodeServerSettings({ compactIdleThreads: true }).compactIdleThreads).toBe(
      "beforeCacheExpires",
    );
    expect(decodeServerSettings({}).compactIdleThreads).toBe("onReturn");
  });
});

describe("ClientSettings notifications", () => {
  it("requires opt-in when existing settings omit notification preferences", () => {
    expect(decodeClientSettings({}).notificationMode).toBe("off");
    expect(decodeClientSettings({}).inAppNotificationsEnabled).toBe(false);
    expect(decodeClientSettingsPatch({})).not.toHaveProperty("inAppNotificationsEnabled");
    expect(decodeClientSettingsPatch({})).not.toHaveProperty("notificationMode");
  });
});

describe("ClientSettings quit confirmation", () => {
  it.each([
    [true, "hold"],
    [false, "direct"],
  ] as const)("migrates the legacy %s value to %s", (legacyValue, mode) => {
    const settings = decodeClientSettings({ confirmQuit: legacyValue });

    expect(settings.confirmQuit).toBe(mode);
    expect(encodeClientSettings(settings).confirmQuit).toBe(mode);
  });
});

describe("provider enabled defaults", () => {
  it("resolves instance enabled state with explicit false winning", () => {
    const grok = ProviderDriverKind.make("grok");
    const codex = ProviderDriverKind.make("codex");
    expect(resolveProviderInstanceEnabled({ driver: grok, config: {} })).toBe(false);
    expect(resolveProviderInstanceEnabled({ driver: codex, config: {} })).toBe(true);
    expect(
      resolveProviderInstanceEnabled({ driver: ProviderDriverKind.make("ollama"), config: {} }),
    ).toBe(true);
    expect(resolveProviderInstanceEnabled({ driver: grok, enabled: true, config: {} })).toBe(true);
    expect(resolveProviderInstanceEnabled({ driver: codex, enabled: false, config: {} })).toBe(
      false,
    );
    expect(resolveProviderInstanceEnabled({ driver: grok, config: { enabled: true } })).toBe(true);
    expect(
      resolveProviderInstanceEnabled({ driver: grok, enabled: true, config: { enabled: false } }),
    ).toBe(false);
    expect(
      resolveProviderInstanceEnabled({ driver: codex, enabled: false, config: { enabled: true } }),
    ).toBe(false);
  });
});

describe("ServerSettings worktree defaults", () => {
  it("defaults the thread env mode to inherit and keeps stored values", () => {
    expect(decodeServerSettings({}).defaultThreadEnvMode).toBeNull();
    expect(decodeServerSettings({ defaultThreadEnvMode: "worktree" }).defaultThreadEnvMode).toBe(
      "worktree",
    );
    expect(
      decodeServerSettings({ defaultThreadEnvMode: "remote" }).defaultThreadEnvMode,
    ).toBeNull();
    expect(
      decodeServerSettingsPatch({ defaultThreadEnvMode: null }).defaultThreadEnvMode,
    ).toBeNull();
  });

  it("keeps an inherited thread env mode off the wire for older clients", () => {
    const encode = Schema.encodeSync(ServerSettings);
    expect("defaultThreadEnvMode" in encode(decodeServerSettings({}))).toBe(false);
    expect(
      encode(decodeServerSettings({ defaultThreadEnvMode: "worktree" })).defaultThreadEnvMode,
    ).toBe("worktree");
  });
});

describe("ServerSettings.sourceControlWritingStyle", () => {
  it.each([
    { legacy: "", mode: "repo_conventions", customInstructions: "" },
    { legacy: " \t\n ", mode: "repo_conventions", customInstructions: "" },
    {
      legacy: "  Prefer concise wording.\nKeep issue references.  ",
      mode: "custom",
      customInstructions: "Prefer concise wording.\nKeep issue references.",
    },
  ])("normalizes legacy writing style $legacy in snapshots only", ({ legacy, ...expected }) => {
    const style = { ...expected, followChangeRequestTemplates: true };
    for (const [input, normalized] of [
      [{ sourceControlWritingStyle: legacy }, { sourceControlWritingStyle: style }],
      [
        { projectSettingsOverrides: { project: { sourceControlWritingStyle: legacy } } },
        { projectSettingsOverrides: { project: { sourceControlWritingStyle: style } } },
      ],
    ] as const) {
      const settings = decodeServerSettings(input);
      expect(settings).toMatchObject(normalized);
      expect(encodeServerSettings(settings)).toMatchObject(normalized);
      expect(() => decodeServerSettingsPatch(input)).toThrow();
    }
  });
});

describe("ServerSettings environment icon", () => {
  it("decodes a kind from a newer server as null instead of failing the snapshot", () => {
    expect(decodeServerSettings({ environmentIcon: "toaster" }).environmentIcon).toBeNull();
  });
});

const decodeDeviceHostSettings = Schema.decodeSync(ServerSettings);

// `deviceHosts` as it was decoded before EAS hosts existed: an SSH host needs a target.
const decodeOlderDeviceHostSettings = Schema.decodeUnknownSync(
  Schema.Struct({
    deviceHosts: Schema.Array(Schema.Struct({ id: Schema.String, target: Schema.String })),
  }),
);

it("keeps EAS hosts out of the SSH host list servers and clients before EAS hosts decode", () => {
  const settings = decodeDeviceHostSettings({
    deviceHosts: [{ id: "mini", label: "Mac mini", target: "user@mini" }],
    easDeviceHosts: [{ kind: "eas", id: "eas", label: "EAS Simulator" }],
  });
  const wire = encodeServerSettings(settings);
  expect(decodeOlderDeviceHostSettings(wire).deviceHosts).toEqual([
    { id: "mini", target: "user@mini" },
  ]);
  expect(settings.easDeviceHosts.map((host) => host.id)).toEqual(["eas"]);
});

it("validates remote device hosts and rejects ambiguous host ids", () => {
  const host = { id: "mini", label: "Mac mini", target: "user@mini", port: 2222 };
  // Hosts saved before EAS hosts existed have no `kind`; they are SSH hosts.
  expect(decodeDeviceHostSettings({ deviceHosts: [host] }).deviceHosts).toEqual([
    { kind: "ssh", ...host },
  ]);
  expect(() => decodeDeviceHostSettings({ deviceHosts: [host, host] })).toThrow();
  expect(() => decodeDeviceHostSettings({ deviceHosts: [{ ...host, id: "local" }] })).toThrow();
  expect(() =>
    decodeDeviceHostSettings({ deviceHosts: [{ ...host, target: "-oProxyCommand=bad" }] }),
  ).toThrow();
  expect(() => decodeDeviceHostSettings({ deviceHosts: [{ ...host, port: 0 }] })).toThrow();
});

describe("resolveProjectProviderInstanceEnabled", () => {
  const projectId = "project-a" as ProjectId;
  const instanceId = ProviderInstanceId.make("codex_work");

  it("lets a project disable an instance the machine enabled", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: true },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: false } } },
      },
    };
    expect(resolveProjectProviderInstanceEnabled(settings, projectId, instanceId)).toBe(false);
  });
});

describe("requiredScopesForProjectMutation", () => {
  it("adds the settings scope only when a mutation carries scripts", () => {
    const projectId = "project-1" as ProjectId;
    const commandId = "command-1" as CommandId;
    expect(
      requiredScopesForProjectMutation({ type: "project.update", commandId, projectId }),
    ).toEqual(["orchestration:operate"]);
    expect(
      requiredScopesForProjectMutation({
        type: "project.update",
        commandId,
        projectId,
        scripts: [],
      }),
    ).toEqual(["orchestration:operate", "settings:write"]);
  });
});

describe("server model preferences", () => {
  it("distinguishes unmigrated lists from deliberately cleared lists", () => {
    expect(decodeServerSettings({})).toMatchObject({
      favorites: null,
      providerModelPreferences: null,
    });
    const input = { favorites: [], providerModelPreferences: {} };
    expect(encodeServerSettings(decodeServerSettings(input))).toMatchObject(input);
    expect(decodeServerSettingsPatch(input)).toEqual(input);
  });
});
