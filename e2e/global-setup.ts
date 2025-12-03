import type { FullConfig } from '@playwright/test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

function waitForPort(host: string, port: number, timeoutMs = 60_000) {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const attempt = () => {
      const socket = net.createConnection({ host, port });
      const onError = () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout waiting for ${host}:${port}`));
        } else {
          setTimeout(attempt, 1000);
        }
      };
      socket.once('error', onError);
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
    };
    attempt();
  });
}

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd: opts.cwd, env: { ...process.env, ...opts.env } });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

export default async function globalSetup(_config: FullConfig) {
  const isCI = !!process.env.CI;

  if (!isCI) {
    // Local dev: start infra via docker compose and wait on localhost
    await run('docker', ['compose', 'up', '-d', 'postgres', 'redis', 'mailpit']);
    await Promise.all([
      waitForPort('127.0.0.1', 5432, 120_000),
      waitForPort('127.0.0.1', 6379, 120_000),
      waitForPort('127.0.0.1', 1025, 120_000),
      waitForPort('127.0.0.1', 8025, 120_000),
    ]);
  } else {
    // CI: service containers are provided by the executor. Wait for them by hostname.
    // Derive DB host/port from any provided DB env var
    const DATABASE_URL_CI =
      process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || process.env.DIRECT_URL ||
      'postgresql://postgres:postgres@postgres:5432/waygate';
    let dbHost = 'postgres';
    let dbPort = 5432;
    try {
      const u = new URL(DATABASE_URL_CI);
      dbHost = u.hostname || dbHost;
      dbPort = u.port ? Number(u.port) : dbPort;
    } catch {}

    const redisHost = process.env.REDIS_HOST || 'redis';
    const redisPort = Number(process.env.REDIS_PORT || '6379');
    const smtpHost = process.env.SMTP_HOST || 'mailhog';
    const smtpPort = Number(process.env.SMTP_PORT || '1025');

    await Promise.all([
      waitForPort(dbHost, dbPort, 120_000),
      waitForPort(redisHost, redisPort, 120_000),
      waitForPort(smtpHost, smtpPort, 120_000),
      waitForPort(smtpHost, 8025, 120_000),
    ]);
  }

  const repoRoot = path.join(__dirname, '..');
  const providerDir = path.join(repoRoot, 'apps', 'provider');

  // Apply DB migrations and seed tenant/client
  const DEFAULT_DB_URL = isCI
    ? 'postgresql://postgres:postgres@postgres:5432/waygate'
    : 'postgresql://postgres:postgres@localhost:5432/waygate';
  const DATABASE_URL =
    process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || process.env.DIRECT_URL ||
    DEFAULT_DB_URL;
  const env = {
    SUPABASE_DATABASE_URL: DATABASE_URL,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'dev_encryption_key_change_me_please_32_chars',
    SESSION_SECRET: process.env.SESSION_SECRET || 'dev_session_secret_change_me_please_32_chars',
  } as NodeJS.ProcessEnv;

  await run('pnpm', ['prisma:generate'], { cwd: providerDir, env });
  // Use migrate deploy to avoid interactive prompts
  await run('pnpm', ['prisma:migrate:deploy'], { cwd: providerDir, env });
  await run('pnpm', ['prisma:seed'], { cwd: providerDir, env });
}
