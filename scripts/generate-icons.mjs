/**
 * Regenerate build/icon.png (512×512) and multi-size build/icon.ico from the brand logo.
 * Requires sharp — fails loudly if missing so stale/broken icons never ship silently.
 * Run: node scripts/generate-icons.mjs
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');

/** Canonical icon source — solid green background, SHEERAZ branding. */
const sourceCandidates = [
  path.join(buildDir, 'sheeraz-traders-desktop-icon.png'),
  path.join(root, 'frontend/public/sheeraz-traders-logo.png'),
  path.join(buildDir, 'icon.png'),
];

const ICON_BG = { r: 27, g: 67, b: 50, alpha: 1 };
const ICO_SIZES = [256, 128, 64, 48, 32, 16];
/** At taskbar sizes, crop to the monogram/wreath so the mark stays visible. */
const COMPACT_SIZES = new Set([16, 32, 48]);

async function loadSharp() {
  const sharpPaths = [
    'sharp',
    path.join(__dirname, 'node_modules/sharp'),
    path.join(root, 'node_modules/sharp'),
  ];

  for (const sharpPath of sharpPaths) {
    try {
      const specifier =
        sharpPath === 'sharp' ? sharpPath : pathToFileURL(path.join(sharpPath, 'lib/index.js')).href;
      const mod = await import(specifier);
      return mod.default;
    } catch {
      // try next location
    }
  }

  throw new Error(
    'sharp is required for icon generation but is not installed. Run: npm install sharp --save-dev',
  );
}

function writeIcoFromPngs(pngPaths, icoPath) {
  const result = spawnSync(`npx png-to-ico@3.0.2 ${pngPaths.map((p) => `"${p}"`).join(' ')}`, {
    cwd: root,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || !result.stdout?.length) {
    throw new Error(result.stderr?.toString() || 'png-to-ico failed');
  }
  fs.writeFileSync(icoPath, result.stdout);
}

async function renderIconPng(sharp, source, size, { compact = false } = {}) {
  let pipeline = sharp(source);

  if (compact) {
    const meta = await sharp(source).metadata();
    const cropHeight = Math.round(meta.height * 0.72);
    pipeline = sharp(source).extract({
      left: 0,
      top: 0,
      width: meta.width,
      height: cropHeight,
    });
  }

  return pipeline
    .resize(size, size, { fit: 'contain', background: ICON_BG })
    .flatten({ background: ICON_BG })
    .png()
    .toBuffer();
}

async function main() {
  const source = sourceCandidates.find((candidate) => fs.existsSync(candidate));
  if (!source) {
    throw new Error(
      `No logo source found. Expected one of:\n${sourceCandidates.map((p) => `  - ${p}`).join('\n')}`,
    );
  }

  const sharp = await loadSharp();
  const iconPng = path.join(buildDir, 'icon.png');
  const iconIco = path.join(buildDir, 'icon.ico');

  fs.mkdirSync(buildDir, { recursive: true });

  fs.writeFileSync(iconPng, await renderIconPng(sharp, source, 512));

  const tempPngs = [];
  for (const size of ICO_SIZES) {
    const tempPath = path.join(buildDir, `_icon-${size}.png`);
    fs.writeFileSync(tempPath, await renderIconPng(sharp, source, size, { compact: COMPACT_SIZES.has(size) }));
    tempPngs.push(tempPath);
  }

  writeIcoFromPngs(tempPngs, iconIco);
  for (const tempPath of tempPngs) {
    fs.unlinkSync(tempPath);
  }

  // electron-builder / NSIS also resolve icons from the project root.
  fs.copyFileSync(iconIco, path.join(root, 'icon.ico'));
  fs.copyFileSync(iconPng, path.join(root, 'icon.png'));

  console.log(`Source: ${path.relative(root, source)}`);
  console.log(`Generated ${path.relative(root, iconPng)} and ${path.relative(root, iconIco)} (${ICO_SIZES.join(', ')}px)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
