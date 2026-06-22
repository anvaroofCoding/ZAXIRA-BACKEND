import { loadBackendEnvFiles } from './load-env';
import * as path from 'node:path';

loadBackendEnvFiles();

const resolveUploadDir = () => {
  const raw = process.env.UPLOAD_DIR ?? './uploads';
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
};

export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '8000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/zaxira',
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-only-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  superAdmin: {
    login: process.env.SUPER_ADMIN_LOGIN ?? 'admin',
    password: process.env.SUPER_ADMIN_PASSWORD ?? '123123',
    secondCode: process.env.SUPER_ADMIN_SECOND_CODE ?? 'admin-ikkinchi-kod',
  },
  /** Ikkinchi maxfiy kod — admin istalgan foydalanuvchi profiliga kirishi uchun */
  adminOverrideCode: process.env.ADMIN_OVERRIDE_CODE ?? '',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  /** QR kodlar va ochiq havolalar uchun frontend domeni (APP_PUBLIC_URL). */
  appPublicUrl: process.env.APP_PUBLIC_URL ?? 'http://localhost:5173',
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
  },
  upload: {
    dir: resolveUploadDir(),
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB ?? '10', 10),
  },
  organization: {
    fullName:
      process.env.ORGANIZATION_FULL_NAME ??
      '“ZAXIRA” axborot tizimi tashkiloti',
    fullNameLatin:
      process.env.ORGANIZATION_FULL_NAME_LATIN ??
      '"Toshkent metropoliteni" DUK',
  },
  apiPublicUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:8000/api',
  onlyoffice: {
    url: process.env.ONLYOFFICE_URL ?? '',
    jwtSecret: process.env.ONLYOFFICE_JWT_SECRET ?? '',
  },
  serpApi: {
    apiKey: process.env.SERPAPI_API_KEY ?? '',
  },
  ai: {
    openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
    openRouterModel:
      process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-chat-v3-0324:free',
  },
});
