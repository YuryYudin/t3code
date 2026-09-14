// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- This standalone release bootstrap runs before the workspace Effect runtime exists.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const APP_STORE_CONNECT_ORIGIN = "https://api.appstoreconnect.apple.com";
const PROFILE_TYPE = "MAC_APP_DIRECT";
const CAPABILITY_TYPE = "ASSOCIATED_DOMAINS";
const PROFILE_MINIMUM_VALIDITY_MS = 7 * 24 * 60 * 60 * 1_000;

type Resource = {
  readonly type: string;
  readonly id: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
};

type ResourceDocument = { readonly data: Resource };
type ResourceListDocument = { readonly data: ReadonlyArray<Resource> };

export type AppleProvisioningProfileResult = {
  readonly content: Buffer;
  readonly bundleIdCreated: boolean;
  readonly capabilityCreated: boolean;
  readonly profileCreated: boolean;
  readonly profileId: string;
};

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function createAppStoreConnectToken({
  issuerId,
  keyId,
  privateKey,
  now = Date.now(),
}: {
  readonly issuerId: string;
  readonly keyId: string;
  readonly privateKey: string;
  readonly now?: number;
}): string {
  const issuedAt = Math.floor(now / 1_000);
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: issuerId,
      iat: issuedAt,
      exp: issuedAt + 20 * 60,
      aud: "appstoreconnect-v1",
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = NodeCrypto.sign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64Url(signature)}`;
}

function resourceContent(resource: Resource): Buffer | null {
  const content = resource.attributes?.profileContent;
  return typeof content === "string" && content.length > 0 ? Buffer.from(content, "base64") : null;
}

function activeProfile(resource: Resource, profileName: string, now: number): boolean {
  const attributes = resource.attributes;
  if (!attributes) return false;
  const name = attributes.name;
  const expirationDate = attributes.expirationDate;
  return (
    typeof name === "string" &&
    (name === profileName || name.startsWith(`${profileName} `)) &&
    attributes.profileType === PROFILE_TYPE &&
    attributes.profileState === "ACTIVE" &&
    typeof expirationDate === "string" &&
    Date.parse(expirationDate) - now >= PROFILE_MINIMUM_VALIDITY_MS &&
    resourceContent(resource) !== null
  );
}

function appleErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { readonly errors?: ReadonlyArray<{ detail?: unknown }> };
    const details = parsed.errors
      ?.map(({ detail }) => (typeof detail === "string" ? detail : null))
      .filter((detail): detail is string => detail !== null);
    if (details && details.length > 0) return `Apple API ${status}: ${details.join("; ")}`;
  } catch {
    // Fall through to the status-only error. Apple may return an HTML gateway response.
  }
  return `Apple API request failed with status ${status}.`;
}

export async function ensureMacProvisioningProfile({
  bundleIdentifier,
  bundleName,
  profileName,
  issuerId,
  keyId,
  privateKey,
  now = Date.now(),
  fetchImpl = fetch,
}: {
  readonly bundleIdentifier: string;
  readonly bundleName: string;
  readonly profileName: string;
  readonly issuerId: string;
  readonly keyId: string;
  readonly privateKey: string;
  readonly now?: number;
  readonly fetchImpl?: typeof fetch;
}): Promise<AppleProvisioningProfileResult> {
  const token = createAppStoreConnectToken({ issuerId, keyId, privateKey, now });
  const request = async <T>(
    method: "GET" | "POST",
    pathname: string,
    body?: unknown,
  ): Promise<T> => {
    const response = await fetchImpl(new URL(pathname, APP_STORE_CONNECT_ORIGIN), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const responseBody = await response.text();
    if (!response.ok) throw new Error(appleErrorMessage(response.status, responseBody));
    return JSON.parse(responseBody) as T;
  };

  const bundleQuery = new URLSearchParams({
    "filter[identifier]": bundleIdentifier,
    "filter[platform]": "MAC_OS",
    limit: "2",
  });
  const bundles = await request<ResourceListDocument>("GET", `/v1/bundleIds?${bundleQuery}`);
  let bundle = bundles.data[0];
  let bundleIdCreated = false;
  if (!bundle) {
    bundle = (
      await request<ResourceDocument>("POST", "/v1/bundleIds", {
        data: {
          type: "bundleIds",
          attributes: { identifier: bundleIdentifier, name: bundleName, platform: "MAC_OS" },
        },
      })
    ).data;
    bundleIdCreated = true;
  }

  const capabilities = await request<ResourceListDocument>(
    "GET",
    `/v1/bundleIds/${encodeURIComponent(bundle.id)}/bundleIdCapabilities?limit=200`,
  );
  let capabilityCreated = false;
  if (!capabilities.data.some(({ attributes }) => attributes?.capabilityType === CAPABILITY_TYPE)) {
    await request<ResourceDocument>("POST", "/v1/bundleIdCapabilities", {
      data: {
        type: "bundleIdCapabilities",
        attributes: { capabilityType: CAPABILITY_TYPE },
        relationships: { bundleId: { data: { type: "bundleIds", id: bundle.id } } },
      },
    });
    capabilityCreated = true;
  }

  const profileFields = "name,profileType,profileState,profileContent,expirationDate";
  const profiles = await request<ResourceListDocument>(
    "GET",
    `/v1/bundleIds/${encodeURIComponent(bundle.id)}/profiles?fields[profiles]=${profileFields}&limit=200`,
  );
  const reusableProfile = profiles.data.find((profile) => activeProfile(profile, profileName, now));
  if (reusableProfile) {
    return {
      content: resourceContent(reusableProfile)!,
      bundleIdCreated,
      capabilityCreated,
      profileCreated: false,
      profileId: reusableProfile.id,
    };
  }

  const certificateQuery = new URLSearchParams({
    "filter[certificateType]": "DEVELOPER_ID_APPLICATION,DEVELOPER_ID_APPLICATION_G2",
    "fields[certificates]": "certificateType,expirationDate,activated",
    limit: "200",
  });
  const certificates = await request<ResourceListDocument>(
    "GET",
    `/v1/certificates?${certificateQuery}`,
  );
  const activeCertificates = certificates.data.filter(({ attributes }) => {
    const expirationDate = attributes?.expirationDate;
    return (
      attributes?.activated !== false &&
      typeof expirationDate === "string" &&
      Date.parse(expirationDate) > now
    );
  });
  if (activeCertificates.length === 0) {
    throw new Error("Apple Developer account has no active Developer ID Application certificate.");
  }

  const datedProfileName = `${profileName} ${new Date(now).toISOString().slice(0, 10)}`;
  const createdProfile = (
    await request<ResourceDocument>("POST", "/v1/profiles", {
      data: {
        type: "profiles",
        attributes: { name: datedProfileName, profileType: PROFILE_TYPE },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: bundle.id } },
          certificates: {
            data: activeCertificates.map(({ id }) => ({ type: "certificates", id })),
          },
        },
      },
    })
  ).data;
  const content = resourceContent(createdProfile);
  if (!content) throw new Error("Apple API created a profile without profileContent.");
  return {
    content,
    bundleIdCreated,
    capabilityCreated,
    profileCreated: true,
    profileId: createdProfile.id,
  };
}

function flag(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

async function main(): Promise<void> {
  const privateKeyPath = process.env.APPLE_API_KEY;
  const issuerId = process.env.APPLE_API_ISSUER;
  const keyId = process.env.APPLE_API_KEY_ID;
  if (!privateKeyPath || !issuerId || !keyId) {
    throw new Error("APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER are required.");
  }
  const outputPath = NodePath.resolve(flag("output"));
  const result = await ensureMacProvisioningProfile({
    bundleIdentifier: flag("bundle-id"),
    bundleName: flag("bundle-name"),
    profileName: flag("profile-name"),
    issuerId,
    keyId,
    privateKey: NodeFS.readFileSync(privateKeyPath, "utf8"),
  });
  NodeFS.mkdirSync(NodePath.dirname(outputPath), { recursive: true });
  NodeFS.writeFileSync(outputPath, result.content, { mode: 0o600 });
  process.stdout.write(
    `${JSON.stringify({
      status: "ready",
      outputPath,
      profileId: result.profileId,
      profileCreated: result.profileCreated,
      bundleIdCreated: result.bundleIdCreated,
      capabilityCreated: result.capabilityCreated,
    })}\n`,
  );
}

const isMain = process.argv[1] && NodeURL.pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) await main();
