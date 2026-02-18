# PayLink - HR, Payroll & Time-clock Software

## Overview
PayLink is a full-stack HR, Payroll & Time-clock application for managing employee and contractor time-tracking, scheduling, payroll and HR for multiple businesses. Built with React + Express + PostgreSQL.

## Tech Stack
- **Frontend**: React + TypeScript, Tailwind CSS, shadcn/ui components, Wouter routing, TanStack Query
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Build**: Vite for frontend, TSX for backend

## Project Structure
```
client/src/
├── pages/           # Route pages (dashboard, employees, time-clock, timesheets, schedule, company, settings)
├── components/      # Reusable components (app-sidebar, theme-provider, theme-toggle)
├── components/ui/   # shadcn/ui base components
├── hooks/           # Custom hooks
├── lib/             # Utilities (queryClient)
server/
├── index.ts         # Express server entry
├── routes.ts        # API route handlers
├── storage.ts       # Database storage layer (IStorage interface)
├── db.ts            # Drizzle database connection
├── seed.ts          # Database seed data
shared/
├── schema.ts        # Drizzle schema + Zod validation + TypeScript types
```

## Database Schema
- `companies` - Business entities (LLC, S-Corp, 501c3, etc.)
- `workers` - Employees and contractors with pay rates
- `time_punches` - Clock in/out/break events
- `time_entries` - Daily time records with hours/overtime
- `schedules` - Shift schedules per worker
- `users` - System users

## API Routes
- `GET/POST /api/companies` - Company management
- `GET/POST /api/workers`, `PATCH /api/workers/:id` - Worker CRUD
- `GET/POST /api/time-punches` - Time clock events
- `GET /api/time-entries`, `PATCH /api/time-entries/:id` - Timesheet management
- `GET/POST /api/schedules` - Schedule management
- `GET /api/dashboard/stats` - Dashboard statistics

## Color Theme
Teal-to-blue gradient matching PayLink logo: primary HSL(180, 55%, 42%), dark sidebar

## Running
- `npm run dev` - Start development server (port 5000)
- `npm run db:push` - Push schema to database

## VPS Deployment
1. Push to GitHub
2. Clone on VPS, install Node.js 20+ and PostgreSQL
3. Set DATABASE_URL, SESSION_SECRET, PORT env vars
4. `npm install && npm run build`
5. `npm run db:push` to create tables
6. `NODE_ENV=production node dist/index.js`
7. Use NGINX reverse proxy + PM2
