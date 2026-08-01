import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3847),
  sessionSecret: process.env.SESSION_SECRET ?? 'grain-market-pos-dev-secret',
  isProduction: (process.env.NODE_ENV ?? 'development') === 'production',
};
