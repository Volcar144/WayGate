import { test, expect } from '@playwright/test';

const RP_BASE = process.env.SMOKE_RP_BASE || 'http://localhost:3001';
const PROVIDER_BASE = process.env.SMOKE_PROVIDER_BASE || 'http://localhost:3000/a/example';

test('OIDC discovery, auth (magic + enchanted), token exchange, userinfo, refresh, and logout', async ({ page, context, request }) => {
  // Discovery
  const disc = await request.get(`${PROVIDER_BASE}/.well-known/openid-configuration`);
  expect(disc.ok()).toBeTruthy();
  const cfg = await disc.json();
  expect(cfg.issuer).toBe(`${PROVIDER_BASE}`);
  expect(cfg.authorization_endpoint).toBe(`${PROVIDER_BASE}/oauth/authorize`);
  expect(cfg.token_endpoint).toBe(`${PROVIDER_BASE}/oauth/token`);

  // Start at RP
  await page.goto(RP_BASE);
  await expect(page.getByRole('heading', { name: 'Waygate RP' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();

  // We should be on provider authorize UI
  await expect(page.getByText('Send magic link')).toBeVisible();
  const email = `e2e-${Date.now()}@example.test`;
  await page.locator('form#magic-form input[name=email]').fill(email);
  // Submit the form and click the debug link
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('form#magic-form button[type=submit]').click(),
  ]);

  // The authorize page will append a debug link; click it (opens in new tab)
  await page.getByRole('link', { name: 'Open magic link (debug)' }).click();

  await popup.waitForLoadState('domcontentloaded');
  await expect(popup.getByText('Signed in')).toBeVisible();

  // The enchanted link (SSE) should have redirected the original tab back to the RP
  await page.waitForURL('**/protected', { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Protected' })).toBeVisible();

  // The protected page renders userinfo
  const pre = page.locator('text="userinfo"').first();
  await expect(page.getByText('Userinfo')).toBeVisible();
  await expect(page.locator('pre').last()).toContainText('email');

  // Extract refresh_token from rp_session cookie and call refresh API
  const cookies = await context.cookies(RP_BASE);
  const sessionCookie = cookies.find((c) => c.name === 'rp_session');
  expect(sessionCookie).toBeTruthy();
  const session = JSON.parse(decodeURIComponent(sessionCookie!.value));
  expect(session.refresh_token).toBeTruthy();

  const refresh = await request.post(`${RP_BASE}/api/waygate/refresh`, {
    data: { refresh_token: session.refresh_token },
  });
  expect(refresh.ok()).toBeTruthy();
  const refreshed = await refresh.json();
  expect(refreshed).toHaveProperty('access_token');
  expect(refreshed).toHaveProperty('id_token');

  // Logout
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(RP_BASE + '/');
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});
