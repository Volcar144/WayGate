#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function log(msg, extra) {
  const t = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(`[${t}] ${msg}`, extra || '');
}

function fail(msg) {
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    log(`$ ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { stdio: 'inherit', cwd: opts.cwd, env: { ...process.env, ...(opts.env || {}) } });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function requireEnv(name, pred, message) {
  const v = process.env[name];
  if (!v) fail(`Missing required env: ${name}${message ? `\n  ${message}` : ''}`);
  if (pred && !pred(v)) fail(`Invalid env ${name}: ${v}${message ? `\n  ${message}` : ''}`);
  return v;
}

async function main() {
  log('Validating required environment variables...');
  requireEnv('SUPABASE_DATABASE_URL', (v) => v.startsWith('postgres')); // basic sanity
  requireEnv('ENCRYPTION_KEY', (v) => v.length >= 32, 'Must be at least 32 characters');
  requireEnv('SESSION_SECRET', (v) => v.length >= 32, 'Must be at least 32 characters');

  // Seed configuration
  const TENANT_SLUG = requireEnv('DEPLOY_TENANT_SLUG');
  const TENANT_NAME = process.env.DEPLOY_TENANT_NAME || TENANT_SLUG;
  const CLIENT_ID = requireEnv('DEPLOY_CLIENT_ID');
  const CLIENT_NAME = process.env.DEPLOY_CLIENT_NAME || 'Waygate RP';
  const REDIRECT_URIS_RAW = requireEnv(
    'DEPLOY_REDIRECT_URIS',
    (v) => v.split(',').map((s) => s.trim()).filter(Boolean).length > 0,
    'Provide a comma-separated list of redirect URIs (use https in production)'
  );
  const REDIRECT_URIS = REDIRECT_URIS_RAW.split(',').map((s) => s.trim()).filter(Boolean);
  const ADMIN_EMAIL = process.env.DEPLOY_ADMIN_EMAIL || '';

  const SMOKE_PROVIDER_BASE = requireEnv('SMOKE_PROVIDER_BASE', (v) => v.includes(`/a/${TENANT_SLUG}`), `Expected to include /a/${TENANT_SLUG}`);
  const SMOKE_RP_BASE = requireEnv('SMOKE_RP_BASE');

  log('Applying database migrations...');
  await run('pnpm', ['--filter', 'provider', 'prisma:migrate:deploy'], {
    env: {
      SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
      SESSION_SECRET: process.env.SESSION_SECRET,
    },
  });

  log('Seeding tenant, client, and admin user...');
  await run('pnpm', ['--filter', 'provider', 'prisma:seed'], {
    env: {
      SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
      SESSION_SECRET: process.env.SESSION_SECRET,
      SEED_TENANT_SLUG: TENANT_SLUG,
      SEED_TENANT_NAME: TENANT_NAME,
      SEED_CLIENT_ID: CLIENT_ID,
      SEED_CLIENT_NAME: CLIENT_NAME,
      SEED_REDIRECT_URIS: REDIRECT_URIS.join(','),
      SEED_ADMIN_EMAIL: ADMIN_EMAIL,
      SEED_ROTATE_KEYS: '1',
    },
  });

  // Optional quick verification of discovery endpoint
  try {
    log('Verifying discovery endpoint...');
    const url = new URL('/.well-known/openid-configuration', SMOKE_PROVIDER_BASE).toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Discovery returned status ${res.status}`);
    const cfg = await res.json();
    if (cfg.issuer !== SMOKE_PROVIDER_BASE) throw new Error(`Issuer mismatch. Expected ${SMOKE_PROVIDER_BASE} got ${cfg.issuer}`);
  } catch (e) {
    log('Warning: discovery verification failed (continuing):', e);
  }

  log('Running smoke tests against production URL...');
  await run('pnpm', ['playwright', 'test', '-c', 'playwright.smoke.config.ts'], {
    env: {
      SMOKE_PROVIDER_BASE,
      SMOKE_RP_BASE,
    },
  });

  // Archive the HTML report into docs
  try {
    const stamp = new Date()
      .toISOString()
      .replace(/[:]/g, '-')
      .replace(/\..+$/, '')
      .replace('T', '_');
    const destLatest = join('docs', 'smoke', 'latest');
    const destStamp = join('docs', 'smoke', stamp);
    if (!existsSync(join('docs', 'smoke'))) mkdirSync(join('docs', 'smoke'), { recursive: true });
    rmSync(destLatest, { recursive: true, force: true });
    cpSync('playwright-report', destLatest, { recursive: true });
    cpSync('playwright-report', destStamp, { recursive: true });
    log(`Smoke test report archived at ${destLatest} and ${destStamp}`);
  } catch (e) {
    log('Warning: failed to archive smoke test report', e);
  }

  log('Done.');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
