import { createSign } from 'node:crypto';

/**
 * OAuth access token for the service account in FIREBASE_SERVICE_ACCOUNT (its JSON key),
 * via the JWT-bearer flow; no SDK needed.
 */
export async function accessToken(scope = 'https://www.googleapis.com/auth/datastore'): Promise<string> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set.');
  const key = JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
  const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}
