import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const isDev = process.env.NODE_ENV === 'development';
const BACKEND_PORT = process.env.PORT ?? '3847';
const APP_NAME = 'Sheeraz Traders';
const PREVIOUS_APP_NAME = 'Sheraz Traders';
const LEGACY_APP_NAME = 'Grain Market POS';
const APP_ID = 'com.sheraztraders.pos';
/** Only show the splash if the backend is still warming up after this grace period. */
const LOADING_GRACE_MS = 400;
/** Poll frequently so login appears as soon as the backend reports ready. */
const HEALTH_POLL_INTERVAL_MS = 100;
const HEALTH_MAX_ATTEMPTS = 100;

/** Chromium date widgets follow app ICU locale, not html lang. Force day-first (DD/MM/YYYY). */
app.commandLine.appendSwitch('lang', 'en-GB');
app.commandLine.appendSwitch('accept-lang', 'en-GB,en');

function resolveAppIcon(): string | undefined {
  const fileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const candidates = isDev
    ? [path.join(__dirname, `../build/${fileName}`)]
    : [
        path.join(process.resourcesPath, `app.asar.unpacked/build/${fileName}`),
        path.join(process.resourcesPath, `build/${fileName}`),
        path.join(__dirname, `../build/${fileName}`),
        path.join(app.getAppPath(), `build/${fileName}`),
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

let mainWindow: BrowserWindow | null = null;
let loadingWindow: BrowserWindow | null = null;
let backendBootPromise: Promise<void> | null = null;

/** Windows 10/11: prevent occluded-window bugs that block mouse/keyboard in the renderer. */
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.setAppUserModelId(APP_ID);
}

/** Keep DB in userData — migrate legacy folder name after rebrand. Must run before app.ready. */
function configureStableUserDataPath(): void {
  if (isDev) return;

  const appData = app.getPath('appData');
  const candidateDirs = [
    path.join(appData, APP_NAME),
    path.join(appData, PREVIOUS_APP_NAME),
    path.join(appData, LEGACY_APP_NAME),
  ];

  for (const dir of candidateDirs) {
    const db = path.join(dir, 'data', 'sheraztrader.db');
    if (fs.existsSync(db)) {
      app.setPath('userData', dir);
      return;
    }
  }

  app.setPath('userData', path.join(appData, APP_NAME));
}

/**
 * Persist a per-install session secret next to the database so packaged builds
 * never fall back to a shared hardcoded string.
 */
function ensurePersistedSessionSecret(dataDir: string): string {
  const secretPath = path.join(dataDir, 'session.secret');
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
  } catch {
    // Fall through and regenerate.
  }

  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretPath, secret, { encoding: 'utf8', mode: 0o600 });
  return secret;
}

function configurePrismaEnginePath(): void {
  if (isDev) return;

  const engineCandidates = [
    path.join(process.resourcesPath, 'app.asar.unpacked/node_modules/.prisma/client/query_engine-windows.dll.node'),
    path.join(process.resourcesPath, 'node_modules/.prisma/client/query_engine-windows.dll.node'),
    path.join(process.resourcesPath, 'node_modules/@prisma/client/query_engine-windows.dll.node'),
    path.join(app.getAppPath(), 'node_modules/.prisma/client/query_engine-windows.dll.node'),
  ];

  for (const candidate of engineCandidates) {
    if (fs.existsSync(candidate)) {
      process.env.PRISMA_QUERY_ENGINE_LIBRARY = candidate;
      return;
    }
  }
}

async function startBackend(): Promise<void> {
  if (isDev) {
    return;
  }

  configurePrismaEnginePath();

  const userDataDir = app.getPath('userData');
  const dataDir = path.join(userDataDir, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  process.env.PORT = BACKEND_PORT;
  process.env.NODE_ENV = 'production';
  process.env.SHERAZ_TRADERS_PACKAGED = '1';
  // Single connection so PRAGMA busy_timeout applies for the app lifetime (avoids intermittent SQLite locks).
  process.env.DATABASE_URL = `file:${path.join(dataDir, 'sheraztrader.db')}?connection_limit=5`;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || ensurePersistedSessionSecret(dataDir);

  const credentialsModule = path.join(__dirname, '../backend/dist/lib/google-oauth-credentials.js');
  if (fs.existsSync(credentialsModule)) {
    const { applyGoogleOAuthCredentialsToEnv } = await import(credentialsModule) as {
      applyGoogleOAuthCredentialsToEnv: () => boolean;
    };
    applyGoogleOAuthCredentialsToEnv();
  }

  const backendEntry = path.join(__dirname, '../backend/dist/index.js');
  // Import kicks off backend startup; readiness is confirmed via /api/health polling.
  await import(backendEntry);
}

/** Begin backend boot as early as possible (parallel with app launch). */
function ensureBackendStarting(): Promise<void> {
  if (isDev) return Promise.resolve();
  if (!backendBootPromise) {
    backendBootPromise = startBackend().catch((err) => {
      backendBootPromise = null;
      throw err;
    });
  }
  return backendBootPromise;
}

function scheduleLoadingWindowIfSlow(): () => void {
  if (isDev) return () => {};

  let shown = false;
  const timer = setTimeout(() => {
    shown = true;
    showLoadingWindow();
  }, LOADING_GRACE_MS);

  return () => {
    clearTimeout(timer);
    if (shown) {
      closeLoadingWindow();
    }
  };
}

function showLoadingWindow(): void {
  if (isDev) return;

  const iconPath = resolveAppIcon();
  loadingWindow = new BrowserWindow({
    width: 420,
    height: 160,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    backgroundColor: '#f4f5f7',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body {
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      font-family: 'Segoe UI', Tahoma, sans-serif;
      background: #f4f5f7;
      color: #1b4332;
      user-select: none;
    }
    .wrap { text-align: center; padding: 1rem; }
    .title { font-size: 1rem; font-weight: 600; margin-bottom: 0.35rem; }
    .sub { font-size: 0.8125rem; color: #4a4a40; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="title">${APP_NAME}</div>
    <div class="sub">Starting local services…</div>
  </div>
</body>
</html>`;

  void loadingWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  loadingWindow.once('ready-to-show', () => {
    loadingWindow?.show();
  });
}

function closeLoadingWindow(): void {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.close();
  }
  loadingWindow = null;
}

async function createWindow(): Promise<void> {
  const iconPath = resolveAppIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    ...(iconPath ? { icon: iconPath } : {}),
    show: false,
    backgroundColor: '#f4f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
      return { action: 'allow' };
    }
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isAllowed = url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:');
    if (!isAllowed) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('Window failed to load:', errorCode, errorDescription, validatedURL);
  });

  const targetUrl = isDev ? 'http://127.0.0.1:5173' : `http://127.0.0.1:${BACKEND_PORT}`;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Application UI failed to load in time.'));
    }, 60_000);

    mainWindow!.webContents.once('did-finish-load', () => {
      clearTimeout(timeout);
      resolve();
    });

    mainWindow!.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
      clearTimeout(timeout);
      reject(new Error(`UI load failed (${errorCode}): ${errorDescription}`));
    });

    void mainWindow!.loadURL(targetUrl);
  });

  closeLoadingWindow();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();

  if (process.env.ELECTRON_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function showStartupError(message: string): Promise<void> {
  closeLoadingWindow();
  await dialog.showMessageBox({
    type: 'error',
    title: `${APP_NAME} — Startup failed`,
    message: 'The application could not start safely.',
    detail: message,
  });
  app.quit();
}

configureStableUserDataPath();

ipcMain.handle('dialog:selectDirectory', async () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
});

app.whenReady().then(async () => {
  const backendPromise = !isDev ? ensureBackendStarting() : Promise.resolve();
  const dismissLoadingGrace = scheduleLoadingWindowIfSlow();

  try {
    if (!isDev) {
      await backendPromise;

      const health = await waitForBackendHealth();
      if (!health.ok) {
        const detail =
          health.database?.error ??
          (health.database && !health.database.integrityOk
            ? 'Database integrity check failed.'
            : 'Backend health check failed.');
        dismissLoadingGrace();
        await showStartupError(detail);
        return;
      }
    }

    dismissLoadingGrace();
    await createWindow();
  } catch (err) {
    dismissLoadingGrace();
    const message = err instanceof Error ? err.message : String(err);
    await showStartupError(message);
    return;
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        await createWindow();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await showStartupError(message);
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

type HealthResponse = {
  ok: boolean;
  database?: {
    exists: boolean;
    migrationsApplied: boolean;
    integrityOk: boolean;
    error: string | null;
  };
};

async function waitForBackendHealth(
  maxAttempts = HEALTH_MAX_ATTEMPTS,
  pollIntervalMs = HEALTH_POLL_INTERVAL_MS,
): Promise<HealthResponse> {
  const url = `http://127.0.0.1:${BACKEND_PORT}/api/health`;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = (await response.json()) as HealthResponse;
        if (data.ok) {
          return data;
        }
      }
    } catch {
      // Server not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error('Backend failed to start');
}
