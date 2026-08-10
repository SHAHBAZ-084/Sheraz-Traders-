/**
 * Regenerate build/icon.png (512×512) and multi-size build/icon.ico from the brand logo.
 * Run: node scripts/generate-icons.mjs
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');

const sourceCandidates = [
  path.join(buildDir, 'sheraz-traders-desktop-icon.png'),
  path.join(root, 'frontend/public/sheeraz-traders-logo.png'),
  path.join(buildDir, 'icon.png'),
];

async function loadSharp() {
  try {
    const mod = await import('sharp');
    return mod.default;
  } catch {
    return null;
  }
}

function writeIcoFromPng(pngPath, icoPath) {
  const result = spawnSync(`npx png-to-ico@3.0.2 "${pngPath}"`, {
    cwd: root,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || !result.stdout?.length) {
    throw new Error(result.stderr?.toString() || 'png-to-ico failed');
  }
  fs.writeFileSync(icoPath, result.stdout);
}

async function main() {
  const source = sourceCandidates.find((candidate) => fs.existsSync(candidate));
  if (!source) {
    throw new Error('No logo source found for icon generation.');
  }

  const iconPng = path.join(buildDir, 'icon.png');
  const iconIco = path.join(buildDir, 'icon.ico');
  const sharp = await loadSharp();
  const bg = { r: 27, g: 67, b: 50, alpha: 1 };

  if (sharp) {
    fs.writeFileSync(
      iconPng,
      await sharp(source).resize(512, 512, { fit: 'contain', background: bg }).png().toBuffer(),
    );

    const sizes = [16, 32, 48, 64, 128, 256];
    const tempPngs = [];
    for (const size of sizes) {
      const tempPath = path.join(buildDir, `_icon-${size}.png`);
      fs.writeFileSync(
        tempPath,
        await sharp(source).resize(size, size, { fit: 'contain', background: bg }).png().toBuffer(),
      );
      tempPngs.push(tempPath);
    }

    const result = spawnSync(`npx png-to-ico@3.0.2 ${tempPngs.map((p) => `"${p}"`).join(' ')}`, {
      cwd: root,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const tempPath of tempPngs) {
      fs.unlinkSync(tempPath);
    }
    if (result.status !== 0 || !result.stdout?.length) {
      throw new Error(result.stderr?.toString() || 'png-to-ico failed');
    }
    fs.writeFileSync(iconIco, result.stdout);
    console.log(`Generated ${iconPng} and ${iconIco} (${sizes.join(', ')}px)`);
    return;
  }

  fs.copyFileSync(source, iconPng);
  writeIcoFromPng(iconPng, iconIco);
  console.log(`Generated ${iconIco} from ${path.basename(source)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
