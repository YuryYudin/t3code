import { useAtomValue } from "@effect/atom-react";
import {
  cliArchiveFileName,
  cliReleaseTagUrl,
  CLI_RELEASE_CHECKSUMS_FILE,
} from "@t3tools/shared/cliRelease";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";

const isRelease = Schema.is(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.Boolean,
    prerelease: Schema.Boolean,
    assets: Schema.Array(Schema.Struct({ name: Schema.String, state: Schema.String })),
  }),
);

export const cliReleasePublishedAtom = Atom.family((version: string) =>
  Atom.make(
    Effect.gen(function* () {
      const response = yield* HttpClient.get(cliReleaseTagUrl(version));
      if (response.status === 404) return false;
      const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap((ok) => ok.json),
      );
      if (!isRelease(body) || body.tag_name !== `v${version}` || body.draft || body.prerelease) {
        return false;
      }
      const uploaded = new Set(
        body.assets.filter((asset) => asset.state === "uploaded").map((asset) => asset.name),
      );
      return (
        uploaded.has(cliArchiveFileName(version, "linux-x64")) &&
        uploaded.has(CLI_RELEASE_CHECKSUMS_FILE)
      );
    }).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(
    Atom.withRefresh("5 minutes"),
    Atom.keepAlive,
    Atom.withLabel(`cli-release-published:${version}`),
  ),
);

const NO_VERSION_ATOM = Atom.make(AsyncResult.success(false)).pipe(
  Atom.withLabel("cli-release-published:none"),
);

export function useCliReleasePublished(version: string | null): boolean {
  const result = useAtomValue(version ? cliReleasePublishedAtom(version) : NO_VERSION_ATOM);
  return AsyncResult.getOrElse(result, () => false);
}
