# Sheeraz Traders — Safe manual update guide

This app is updated **manually only** (USB / copied installer). There is no GitHub or online auto-update.

## Where your data lives (never inside the install folder)

| Item | Location (Windows) |
|------|---------------------|
| Database | `%APPDATA%\Sheeraz Traders\data\sheraztrader.db` |
| Local backups | `%APPDATA%\Sheeraz Traders\data\backups\` |
| Logs | `%APPDATA%\Sheeraz Traders\data\logs\` |
| Google Drive tokens | `%APPDATA%\Sheeraz Traders\` (encrypted) |

The NSIS installer/uninstaller **does not** delete this folder (`deleteAppDataOnUninstall: false`).

Upgrading replaces files under `C:\Program Files\Sheeraz Traders\` (or your chosen install path) only.

**Rebrand note:** If you installed an older build named “Sheraz Traders” or “Grain Market POS”, the app automatically continues using the existing `%APPDATA%\Sheeraz Traders\`, `%APPDATA%\Sheraz Traders\`, or `%APPDATA%\Grain Market POS\` folder (whichever contains your database), so existing databases are not orphaned.

## How to update (production)

1. **Optional but recommended:** trigger **Database Maintenance → Google Drive backup** (or copy `sheraztrader.db` manually).
2. Close Sheeraz Traders completely.
3. Copy the new installer (e.g. `Sheeraz Traders Setup 0.1.0.exe`) via USB.
4. Run the installer **over** the existing installation (same or new install directory is fine).
5. Launch the app. On first start after update:
   - A **local backup** is taken automatically if the database already exists.
   - **Pending migrations** run programmatically (same as `prisma migrate deploy` — additive only, never reset).
   - If migration or integrity check fails, the app **does not open** and shows an error dialog.

## What the app never does on update

- `prisma db push --force-reset`
- `prisma migrate dev`
- Deleting or overwriting `userData/data/` during install/uninstall

## Code signing

Installers are **unsigned** unless you provide a Windows code-signing certificate. Expect SmartScreen “Unknown publisher” until signed.

## Build commands

```bash
npm run dist:win
```

Output: `release/Sheeraz Traders Setup <version>.exe`
