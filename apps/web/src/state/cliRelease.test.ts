import { AtomRegistry } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";

import { cliReleasePublishedAtom } from "./cliRelease";

const version = "0.1.1-2";

// FetchHttpClient reads globalThis.fetch once and keeps it, so every test shares this mock.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

async function settledCheck() {
  const atom = cliReleasePublishedAtom(version);
  const registry = AtomRegistry.make();
  const unmount = registry.mount(atom);
  try {
    await vi.waitFor(() => {
      const result = registry.get(atom);
      expect(AsyncResult.isInitial(result) || result.waiting).toBe(false);
    });
    return registry.get(atom);
  } finally {
    unmount();
    registry.dispose();
  }
}

const release = {
  tag_name: `v${version}`,
  draft: false,
  prerelease: false,
  assets: [
    { name: `t3-${version}-linux-x64.tar.gz`, state: "uploaded" },
    { name: "SHA256SUMS", state: "uploaded" },
  ],
};

describe("cliReleasePublishedAtom", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("checks the published fork archive without tracing headers", async () => {
    fetchMock.mockImplementation(async () => Response.json(release));

    const result = await settledCheck();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = new Request(fetchMock.mock.calls[0]?.[0] ?? "", fetchMock.mock.calls[0]?.[1]);
    expect(request.url).toBe(
      `https://api.github.com/repos/YuryYudin/t3code/releases/tags/v${version}`,
    );
    expect(request.headers.get("traceparent")).toBeNull();
    expect(request.headers.get("b3")).toBeNull();
    expect(AsyncResult.getOrElse(result, () => false)).toBe(true);
  });

  it.each([
    { ...release, draft: true },
    { ...release, prerelease: true },
    { ...release, tag_name: "v0.1.1-1" },
    { ...release, assets: release.assets.slice(0, 1) },
    { ...release, assets: release.assets.slice(1) },
    { ...release, assets: release.assets.map((asset) => ({ ...asset, state: "new" })) },
    { ...release, assets: [] },
    { version },
  ])(
    "keeps unavailable, withdrawn, or incomplete server releases out of Update everything: %j",
    async (body) => {
      fetchMock.mockImplementation(async () => Response.json(body));
      const result = await settledCheck();
      expect(AsyncResult.isSuccess(result)).toBe(true);
      expect(AsyncResult.getOrElse(result, () => true)).toBe(false);
    },
  );

  // regression: #18709 update-everything skipped npm-installed servers
  it("reports a missing GitHub release as unpublished", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }));

    const result = await settledCheck();

    expect(AsyncResult.isSuccess(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => true)).toBe(false);
  });

  it("leaves a failed first check unknown, which callers read as unpublished", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await settledCheck();

    expect(AsyncResult.isFailure(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => false)).toBe(false);
  });
});
