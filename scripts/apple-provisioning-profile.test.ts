import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createAppStoreConnectToken,
  ensureMacProvisioningProfile,
} from "./apple-provisioning-profile.ts";

const now = Date.parse("2026-09-14T12:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createAppStoreConnectToken", () => {
  it("creates a verifiable 20-minute App Store Connect JWT", () => {
    const token = createAppStoreConnectToken({
      issuerId: "issuer",
      keyId: "KEY123",
      privateKey: privateKeyPem,
      now,
    });
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    expect(JSON.parse(Buffer.from(encodedHeader!, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "KEY123",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(encodedPayload!, "base64url").toString())).toEqual({
      iss: "issuer",
      iat: now / 1_000,
      exp: now / 1_000 + 1_200,
      aud: "appstoreconnect-v1",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(encodedSignature!, "base64url"),
      ),
    ).toBe(true);
  });
});

describe("ensureMacProvisioningProfile", () => {
  it("reuses an active profile without mutating Apple resources", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ data: [{ type: "bundleIds", id: "bundle-1" }] }))
      .mockResolvedValueOnce(
        response({
          data: [
            {
              type: "bundleIdCapabilities",
              id: "capability-1",
              attributes: { capabilityType: "ASSOCIATED_DOMAINS" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          data: [
            {
              type: "profiles",
              id: "profile-1",
              attributes: {
                name: "T3 Code Fork Developer ID 2026-09-01",
                profileType: "MAC_APP_DIRECT",
                profileState: "ACTIVE",
                profileContent: Buffer.from("profile").toString("base64"),
                expirationDate: "2027-09-01T00:00:00.000Z",
              },
            },
          ],
        }),
      );

    const result = await ensureMacProvisioningProfile({
      bundleIdentifier: "com.tapnetix.t3code",
      bundleName: "T3 Code Fork",
      profileName: "T3 Code Fork Developer ID",
      issuerId: "issuer",
      keyId: "KEY123",
      privateKey: privateKeyPem,
      now,
      fetchImpl,
    });

    expect(result).toMatchObject({
      bundleIdCreated: false,
      capabilityCreated: false,
      profileCreated: false,
      profileId: "profile-1",
    });
    expect(result.content.toString()).toBe("profile");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("creates the bundle, capability, and profile with active Developer ID certificates", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(response({ data: { type: "bundleIds", id: "bundle-new" } }, 201))
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(
        response({ data: { type: "bundleIdCapabilities", id: "capability-new" } }, 201),
      )
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(
        response({
          data: [
            {
              type: "certificates",
              id: "certificate-active",
              attributes: { activated: true, expirationDate: "2027-09-01T00:00:00.000Z" },
            },
            {
              type: "certificates",
              id: "certificate-expired",
              attributes: { activated: true, expirationDate: "2026-01-01T00:00:00.000Z" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response(
          {
            data: {
              type: "profiles",
              id: "profile-new",
              attributes: { profileContent: Buffer.from("new-profile").toString("base64") },
            },
          },
          201,
        ),
      );

    const result = await ensureMacProvisioningProfile({
      bundleIdentifier: "com.tapnetix.t3code",
      bundleName: "T3 Code Fork",
      profileName: "T3 Code Fork Developer ID",
      issuerId: "issuer",
      keyId: "KEY123",
      privateKey: privateKeyPem,
      now,
      fetchImpl,
    });

    expect(result).toMatchObject({
      bundleIdCreated: true,
      capabilityCreated: true,
      profileCreated: true,
      profileId: "profile-new",
    });
    expect(result.content.toString()).toBe("new-profile");
    const profileRequest = fetchImpl.mock.calls[6]!;
    expect(JSON.parse(String((profileRequest[1] as RequestInit).body))).toMatchObject({
      data: {
        attributes: {
          name: "T3 Code Fork Developer ID 2026-09-14",
          profileType: "MAC_APP_DIRECT",
        },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: "bundle-new" } },
          certificates: {
            data: [{ type: "certificates", id: "certificate-active" }],
          },
        },
      },
    });
  });
});
