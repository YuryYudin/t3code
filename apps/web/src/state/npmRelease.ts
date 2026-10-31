import {
  cliReleaseDatabaseMigration,
  cliReleaseIndexPageUrl,
  cliReleaseMigrationsUrl,
  newestCliReleaseVersion,
} from "@t3tools/shared/cliRelease";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { Atom } from "effect/reactivity";

export interface NpmRelease {
  readonly version: string;
  /** Absent on releases published before server manifests carried it. */
  readonly databaseMigration: number | undefined;
}

const isReleaseIndex = Schema.is(
  Schema.Array(
    Schema.Struct({
      tag_name: Schema.String,
      draft: Schema.optionalKey(Schema.Boolean),
      prerelease: Schema.optionalKey(Schema.Boolean),
    }),
  ),
);

/** `spec` is the desktop channel name. Null when the fork has no published release on that track. */
export const npmReleaseAtom = Atom.family((spec: string) =>
  Atom.make(
    Effect.gen(function* () {
      const channel = spec === "nightly" ? "nightly" : spec === "latest" ? "stable" : null;
      if (channel === null) return null;
      let version: string | undefined;
      for (let page = 1; page <= 10; page += 1) {
        const response = yield* HttpClient.get(cliReleaseIndexPageUrl(page));
        const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
          Effect.flatMap((ok) => ok.json),
        );
        if (!isReleaseIndex(body)) return null;
        version = newestCliReleaseVersion(body, channel);
        if (version !== undefined || body.length < 100) break;
      }
      if (version === undefined) return null;
      const manifestResponse = yield* HttpClient.get(cliReleaseMigrationsUrl(version));
      const migrationSource = yield* HttpClientResponse.filterStatusOk(manifestResponse).pipe(
        Effect.flatMap((ok) => ok.text),
      );
      return {
        version,
        databaseMigration: cliReleaseDatabaseMigration(migrationSource),
      } satisfies NpmRelease;
    }).pipe(
      // Tracing headers would make the browser send CORS preflights that public release hosts reject.
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(Atom.withRefresh("5 minutes"), Atom.withLabel(`npm-release:${spec}`)),
);
