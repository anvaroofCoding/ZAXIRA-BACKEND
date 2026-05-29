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
  },
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
  },
  upload: {
    dir: process.env.UPLOAD_DIR ?? './uploads',
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB ?? '10', 10),
  },
  organization: {
    fullName:
      process.env.ORGANIZATION_FULL_NAME ??
      '“ZAXIRA” axborot tizimi tashkiloti',
  },
});
