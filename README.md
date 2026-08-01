# Grain Market POS

Offline desktop point-of-sale for a single grain market client.

## Stack

- **Desktop:** Electron
- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Backend:** Node.js + Express + TypeScript (local, inside Electron)
- **Database:** SQLite via Prisma ORM
- **Auth:** Single local login with session cookies (no JWT, no roles)

## Getting started

```bash
cd "Grain market Project"
npm install
npm run db:migrate -w backend
npm run db:seed -w backend
npm run dev
```

Default login (change after first use):

- Username: `admin`
- Password: `admin123`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend, Vite frontend, and Electron |
| `npm run electron:build` | Build backend, frontend, and Electron main process |
| `npm start` | Run packaged Electron app (after build) |
| `npm run db:migrate -w backend` | Run Prisma migrations |
| `npm run db:seed -w backend` | Seed default admin user |

## Architecture

- Express API runs on `http://127.0.0.1:3847`
- In development, Vite serves the UI on port `5173` and proxies `/api` to the backend
- In production, Express serves the built frontend and Electron loads `http://127.0.0.1:3847`
- SQLite database file: `backend/prisma/data/sheraztrader.db`

## Accounting (copied from CROWNEV reference)

Core double-entry accounting is wired up under `/api/accounting/*`:

- Chart of accounts, vouchers, ledger, trial balance, financial years
- Single-shop schema (no `branchId`)
- Default categories and accounts seeded on first run

Invoice posting patterns from CROWNEV (`createSaleInvoice`, `createPurchaseInvoice`, `createServiceInvoice`) will be adapted next when you define grain sales/purchase flows.
