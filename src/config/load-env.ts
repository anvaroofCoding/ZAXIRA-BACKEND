import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

/** Backend root dagi `.env` faylini cwd dan qat’i nazar yuklaydi. */
export function loadBackendEnvFiles(): string[] {
  const candidates: string[] = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), 'ZAXIRA-BACKEND', '.env.local'),
    resolve(process.cwd(), 'ZAXIRA-BACKEND', '.env'),
  ];

  let dir = __dirname;
  for (let depth = 0; depth < 6; depth += 1) {
    candidates.push(resolve(dir, '.env.local'));
    candidates.push(resolve(dir, '.env'));
    dir = dirname(dir);
  }

  const loaded: string[] = [];

  for (const filePath of [...new Set(candidates)]) {
    if (!existsSync(filePath)) continue;
    loadDotenv({ path: filePath, override: false });
    loaded.push(filePath);
  }

  return loaded;
}

export function isSerpApiConfigured(): boolean {
  return Boolean(process.env.SERPAPI_API_KEY?.trim());
}
