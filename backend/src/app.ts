import path from 'path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import session from 'express-session';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './modules/auth/auth.routes';
import { accountingRouter } from './modules/accounting/accounting.routes';
import { partiesRouter } from './modules/parties/parties.routes';
import { productsRouter } from './modules/products/products.routes';
import { invoicesRouter } from './modules/invoices/invoices.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { preferencesRouter } from './modules/preferences/preferences.routes';
import { createSystemHealthHandler, systemRouter } from './modules/system/system.routes';
import { stockRouter } from './modules/stock/stock.routes';
import { storesRouter } from './modules/stores/stores.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { approvalsRouter } from './modules/approvals/approvals.routes';
import type { StartupStatus } from './lib/startup';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}

export function createApp(getStartupStatus?: () => StartupStatus | null) {
  const app = express();

  app.use(
    cors({
      origin: env.isProduction
        ? [`http://127.0.0.1:${env.port}`, `http://localhost:${env.port}`]
        : ['http://localhost:5173', 'http://127.0.0.1:5173', `http://127.0.0.1:${env.port}`],
      credentials: true,
    }),
  );

  app.use(express.json());
  app.use(cookieParser());
  app.use(
    session({
      secret: env.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 1000 * 60 * 60 * 12,
      },
    }),
  );

  app.get('/api/health', createSystemHealthHandler(getStartupStatus));

  app.use('/api/auth', authRouter);
  app.use('/api/accounting', accountingRouter);
  app.use('/api/parties', partiesRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/stock', stockRouter);
  app.use('/api/stores', storesRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/approvals', approvalsRouter);
  app.use('/api/preferences', preferencesRouter);
  app.use('/api/system', systemRouter);

  if (env.isProduction) {
    const frontendDist = path.resolve(__dirname, '../../frontend/dist');
    app.use(express.static(frontendDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
