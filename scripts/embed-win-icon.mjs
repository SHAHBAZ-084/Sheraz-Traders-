/**
 * Embed build/icon.ico into the packaged Windows exe after electron-builder packs.
 * Uses node-rcedit directly — avoids app-builder/winCodeSign cache failures on Windows.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { rcedit } from 'rcedit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

export default async function embedWinIcon(context) {
  if (context.electronPlatformName !== 'win32') return;

  const product = context.packager.appInfo.productFilename;
  const exe = path.join(context.appOutDir, `${product}.exe`);
  const ico = path.join(root, 'build', 'icon.ico');

  if (!fs.existsSync(exe)) throw new Error(`Missing packaged exe: ${exe}`);
  if (!fs.existsSync(ico)) throw new Error(`Missing icon: ${ico}. Run npm run icons:generate`);

  await rcedit(exe, {
    icon: ico,
    'version-string': {
      ProductName: product,
    },
  });

  console.log(`Embedded brand icon into ${path.relative(root, exe)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const exeArg = process.argv[2];
  if (!exeArg) {
    console.error('Usage: node scripts/embed-win-icon.mjs <path-to-exe>');
    process.exit(1);
  }
  const exe = path.resolve(exeArg);
  embedWinIcon({
    electronPlatformName: 'win32',
    appOutDir: path.dirname(exe),
    packager: { appInfo: { productFilename: path.basename(exe, '.exe') } },
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
