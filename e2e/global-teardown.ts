import { FullConfig } from '@playwright/test';
import { spawn } from 'node:child_process';

function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
}

export default async function globalTeardown(_config: FullConfig) {
  await run('docker', ['compose', 'down', '-v']);
}
