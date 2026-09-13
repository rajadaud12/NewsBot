import { existsSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
};
const succeeds = (command, args) => spawnSync(command, args, { cwd: process.cwd(), stdio: 'ignore' }).status === 0;

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example. Add your integration credentials when ready.');
}

if (!succeeds('docker', ['info'])) {
  if (process.platform === 'darwin') {
    console.log('Starting Docker Desktop...');
    spawnSync('open', ['-a', 'Docker'], { stdio: 'ignore' });
    for (let attempt = 0; attempt < 45 && !succeeds('docker', ['info']); attempt += 1) pause(2_000);
  }
}

if (!succeeds('docker', ['info'])) {
  throw new Error('Docker is not available. Start Docker Desktop, wait until it reports Running, then rerun npm run setup.');
}

run('docker', ['compose', 'up', '-d']);
console.log('Waiting for PostgreSQL and Redis health checks...');
for (let attempt = 0; attempt < 30; attempt += 1) {
  const postgresReady = succeeds('docker', ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'newsbot', '-d', 'newsbot']);
  const redisReady = succeeds('docker', ['compose', 'exec', '-T', 'redis', 'redis-cli', 'ping']);
  if (postgresReady && redisReady) break;
  if (attempt === 29) throw new Error('PostgreSQL or Redis did not become healthy. Run docker compose ps and docker compose logs.');
  pause(2_000);
}

run('node', ['scripts/prisma.mjs', 'generate']);
run('node', ['scripts/prisma.mjs', 'migrate', 'deploy']);
console.log('Setup complete. Run npm run dev:all.');
