import { AtomRegistry } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";

import { npmReleaseAtom } from "./npmRelease";

const version = "0.1.2-3";
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

async function settledRelease() {
  const atom = npmReleaseAtom("latest");
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

describe("npmReleaseAtom", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("reads the fork release and its migration metadata without tracing headers", async () => {
    fetchMock
      .mockImplementationOnce(async () =>
        Response.json([{ tag_name: `v${version}`, draft: false, prerelease: false }]),
      )
      .mockImplementationOnce(
        async () => new Response('[71, "Earlier", Migration0071],\n[72, "Latest", Migration0072],'),
      );

    const result = await settledRelease();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requests = fetchMock.mock.calls.map((call) => new Request(call[0] ?? "", call[1]));
    expect(requests[0]?.url).toBe(
      "https://api.github.com/repos/YuryYudin/t3code/releases?per_page=100&page=1",
    );
    expect(requests[1]?.url).toBe(
      `https://raw.githubusercontent.com/YuryYudin/t3code/v${version}/apps/server/src/persistence/Migrations.ts`,
    );
    expect(requests.every((request) => request.headers.get("traceparent") === null)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => null)).toEqual({
      version,
      databaseMigration: 72,
    });
  });

  it("leaves a failed release check unknown", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await settledRelease();

    expect(AsyncResult.isFailure(result)).toBe(true);
  });
});
