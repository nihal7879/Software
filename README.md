# 🎓 Tuition Institute ERP

Enterprise tuition-center management: **students, parents, faculty, management** — with prepaid **hours tracking**, **fee tracking**, packages, lectures, reports and analytics. Built from the real `Trail` Excel workbook (Form-No keyed, AED currency, negative-hours model).

> Build spec lives in [`BUILD_PROMPT.md`](./BUILD_PROMPT.md).

## Stack
- **Frontend:** React + TypeScript + Tailwind + React Hook Form + Zod + Recharts + TanStack Query
- **Backend:** Node + Express + TypeScript + mysql2, JWT auth + RBAC
- **Database:** MySQL 8

## Layout
```
database/   schema.sql + seed.sql (the 6 real students + edge cases)
server/     Express + TS API
client/     React + TS + Tailwind app
```

## Prerequisites
- Node.js 18+
- MySQL 8 running locally

## 1. Database + Backend
```bash
cd server
cp .env.example .env          # set DB_PASSWORD etc.
npm install

# create schema + seed
npm run db:migrate            # runs ../database/schema.sql
npm run db:seed               # runs ../database/seed.sql

# set a real password hash for all demo users (default password: password123)
npm run hash password123      # prints an UPDATE statement — run it in MySQL,
                              # OR just keep password123 and run the printed SQL.

npm run dev                   # API on http://localhost:4000
```
> **Login passwords:** the seed inserts a placeholder hash. Run `npm run hash password123`
> and execute the printed `UPDATE users SET password_hash='...'` once, so every demo
> account logs in with **password123**.

## 2. Frontend
```bash
cd client
npm install
npm run dev                   # app on http://localhost:5173 (proxies /api -> :4000)
```

## Demo accounts (password: `password123`)
| Role | Email |
|------|-------|
| Admin | admin@tuition.ae |
| Faculty | sachin@tuition.ae |
| Student | sofia@tuition.ae |
| Parent | zelia@tuition.ae |

## The four views
- **Student** — dashboard (hours/fees/teachers), lecture history, fees, profile.
- **Parent** — child overview, attendance, lectures, fees (+ disabled "Pay Now" stub).
- **Faculty** — workload dashboard, pick a student & assign teacher/subject, **lecture entry** (group-capable, auto-duration).
- **Management/Admin** — analytics, students CRUD, **Hours Ledger (154-Summary)**, **Finance Tracker**, teachers, **Finance & Hours pivots**.

## Business rules baked in
- **Form No** is the universal key.
- Status is 3-state: `Active` / `Inactive` / `SP-Active`.
- **Hours Left can be negative** (overconsumption → "Payment Required"). Never clamped.
- `Total Credited = Committed + Discount + Adjusted`; `Left = Credited − Consumed`.
- **Group lectures**: one session → many attendees (`lecture_attendees`), hours consumed per student.
- Currency is **AED**; monthly **Finance** & **Hours** pivots (the live ledger is the `student_hours_summary` SQL view).
- Payment gateway intentionally **not** integrated — clean seam left for Razorpay/Stripe (`POST /api/fees/pay/:id` returns 501).

## Key API endpoints
```
POST /api/auth/login
GET  /api/students            (admin/faculty, search+filter+paginate)
POST /api/students
GET  /api/fees/ledger         (full 154-Summary)
GET  /api/fees/ledger/:id     (one student)
POST /api/fees/transactions
POST /api/lectures            (group-capable; auto duration)
POST /api/teachers/assign
GET  /api/analytics/overview | finance-pivot | hours-pivot | teacher-workload
```

## Not yet implemented (hooks present, see BUILD_PROMPT §7)
Excel bulk import, report export (Excel/CSV/PDF), email/SMS notifications, online payments, multi-branch UI. The schema + API are structured so these slot in without rework.
```
```
