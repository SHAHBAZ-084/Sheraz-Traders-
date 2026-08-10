import { app, BrowserWindow, dialog, shell } from 'electron';
import fs from 'fs';
import path from 'path';

const isDev = process.env.NODE_ENV === 'development';
const BACKEND_PORT = process.env.PORT ?? '3847';
const APP_NAME = 'Sheeraz Traders';
const PREVIOUS_APP_NAME = 'Sheraz Traders';
const LEGACY_APP_NAME = 'Grain Market POS';
const APP_ID = 'com.sheraztraders.pos';

function resolveAppIcon(): string {
  const winIcon = process.platform === 'win32';
  const fileName = winIcon ? 'icon.ico' : 'icon.png';
  const candidates = [
    path.join(__dirname, `../build/${fileName}`),
    path.join(app.getAppPath(), `build/${fileName}`),
    path.join(process.resourcesPath, `app.asar.unpacked/build/${fileName}`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0]!;
}

let mainWindow: BrowserWindow | null = null;
let loadingWindow: BrowserWindow | null = null;

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

function decodeConfig(chunks: string[]): string {
  return Buffer.from(chunks.join(''), 'base64').toString('utf8');
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
  process.env.DATABASE_URL = `file:${path.join(dataDir, 'sheraztrader.db')}`;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'grain-market-pos-prod-secret';
  process.env.GOOGLE_DRIVE_CLIENT_ID =
    process.env.GOOGLE_DRIVE_CLIENT_ID ||
    decodeConfig(['MTcxNjMz', 'NjQwMzYxLWhhMG5iZnFmc3AwMHZ0bHUydnZqcDZuazUzM3ZocTUw', 'LmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t']);
  process.env.GOOGLE_DRIVE_CLIENT_SECRET =
    process.env.GOOGLE_DRIVE_CLIENT_SECRET || decodeConfig(['R09DU1BY', 'LU5aczJ4d05fRnYzMDRoQU5xT25kNHA1cnBneG8=']);

  const backendEntry = path.join(__dirname, '../backend/dist/index.js');
  const backend = await import(backendEntry);
  if (typeof backend.backendReady?.then === 'function') {
    await backend.backendReady;
  }
}

function showLoadingWindow(): void {
  if (isDev) return;

  loadingWindow = new BrowserWindow({
    width: 420,
    height: 160,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    backgroundColor: '#f4f5f7',
    icon: resolveAppIcon(),
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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    icon: resolveAppIcon(),
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

app.whenReady().then(async () => {
  try {
    if (!isDev) {
      showLoadingWindow();
    }

    await startBackend();

    if (!isDev) {
      const health = await waitForBackendHealth();
      if (!health.ok) {
        const detail =
          health.database?.error ??
          (health.database && !health.database.integrityOk
            ? 'Database integrity check failed.'
            : 'Backend health check failed.');
        await showStartupError(detail);
        return;
      }
    }

    await createWindow();
  } catch (err) {
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

async function waitForBackendHealth(maxAttempts = 40): Promise<HealthResponse> {
  const url = `http://127.0.0.1:${BACKEND_PORT}/api/health`;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return (await response.json()) as HealthResponse;
      }
    } catch {
      // Server not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Backend failed to start');
}
