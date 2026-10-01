import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

// Read-only Notary API probe. Keep the private key and bearer token in memory;
// report only public key metadata and selected response fields.
async function main() {
  const issuer = process.env.APPLE_API_ISSUER;
  const keyId = process.env.APPLE_API_KEY_ID;
  const keyPath = process.env.APPLE_API_KEY;
  if (!issuer || !keyId || !keyPath) throw new Error("Missing Apple credential bindings");
  const key = NodeFS.readFileSync(keyPath, "utf8");
  const publicKey = NodeCrypto.createPublicKey(key);
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const message = `${encode({ alg: "ES256", kid: keyId, typ: "JWT" })}.${encode({
    iss: issuer,
    iat: now - 30,
    exp: now + 300,
    aud: "appstoreconnect-v1",
  })}`;
  const signature = NodeCrypto.sign("sha256", Buffer.from(message), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  const token = `${message}.${signature.toString("base64url")}`;
  const redact = (value: unknown) => {
    if (typeof value !== "string") return undefined;
    let result = value;
    for (const secret of [issuer, keyId, keyPath, key, token]) {
      result = result.replaceAll(secret, "[redacted]");
    }
    return result.slice(0, 1500);
  };
  console.log(
    JSON.stringify({
      probe: "Developer ID Notary API: previous submissions",
      node: process.env.NODE_NAME,
      nodeVersion: process.version,
      utc: new Date().toISOString(),
      publicKeySha256: NodeCrypto.createHash("sha256")
        .update(publicKey.export({ type: "spki", format: "der" }))
        .digest("hex"),
      jwtSignatureVerified: NodeCrypto.verify(
        "sha256",
        Buffer.from(message),
        {
          key: publicKey,
          dsaEncoding: "ieee-p1363",
        },
        signature,
      ),
      proxyConfigured: ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"].some((name) =>
        Boolean(process.env[name]),
      ),
      tlsVerificationDisabled: process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0",
    }),
  );
  const response = await fetch("https://appstoreconnect.apple.com/notary/v2/submissions", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json()) as {
    errors?: Array<{ code?: string; title?: string; detail?: string }>;
    data?: unknown[];
  };
  const appleDate = response.headers.get("date");
  console.log(
    JSON.stringify({
      httpStatus: response.status,
      appleDate,
      clockSkewSeconds: appleDate ? Math.round((Date.now() - Date.parse(appleDate)) / 1000) : null,
      errors: body.errors?.map(({ code, title, detail }) => ({
        code: redact(code),
        title: redact(title),
        detail: redact(detail),
      })),
      submissionCount: Array.isArray(body.data) ? body.data.length : undefined,
    }),
  );
  if (!response.ok) process.exitCode = 1;
}

main().catch(() => {
  // Avoid raw exception output: crypto or transport errors can contain inputs.
  console.error("Notary API diagnostic failed before receiving a usable JSON response.");
  process.exitCode = 1;
});
