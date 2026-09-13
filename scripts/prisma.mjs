import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const candidates = ['backend/node_modules/prisma/build/index.js', 'node_modules/prisma/build/index.js'];
const prisma = candidates.find(existsSync);
if (!prisma) throw new Error('Prisma CLI is not installed. Run npm install first.');

const env = { ...process.env };
if (existsSync('.env')) {
  for (const rawLine of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
}

const args = [...process.argv.slice(2), '--schema', 'backend/prisma/schema.prisma'];
const result = spawnSync(process.execPath, [prisma, ...args], { cwd: process.cwd(), env, stdio: 'inherit' });
process.exit(result.status ?? 1);
