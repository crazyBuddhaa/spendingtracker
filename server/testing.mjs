const base64Url = (bytes) => Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Creates an Access-like issuer: signs RS256 tokens and serves its JWKS. */
export async function createFakeAccess(team = "https://example-team.cloudflareaccess.com", aud = "test-aud") {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "test-key" };
  const sign = async (claims, kid = "test-key") => {
    const header = base64Url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
    const now = Math.floor(Date.now() / 1000);
    const payload = base64Url(JSON.stringify({ aud: [aud], iss: team, exp: now + 3600, iat: now, ...claims }));
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
    return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
  };
  const fetcher = async (url) => {
    if (url !== `${team}/cdn-cgi/access/certs`) return new Response("not found", { status: 404 });
    return Response.json({ keys: [jwk] });
  };
  return { team, aud, sign, fetcher, env: { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } };
}
