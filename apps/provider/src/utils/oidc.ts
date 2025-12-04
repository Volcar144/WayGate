export type OidcDiscovery = {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
  userinfo_endpoint?: string;
};

/**
 * Fetch OpenID Provider Configuration (RFC 8414/.well-known/openid-configuration).
 * Returns null on network/parse errors or non-2xx responses.
 */
export async function discoverOidc(issuer: string, timeoutMs = 10_000): Promise<OidcDiscovery | null> {
  try {
    const wellKnown = issuer.replace(/\/$/, '') + '/.well-known/openid-configuration';
    const res = await fetch(wellKnown, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as OidcDiscovery;
    return json || null;
  } catch {
    return null;
  }
}
