# Build Prompt — Tuition Institute ERP & Hours/Fees Management System

> Paste this prompt into your AI builder / give it to your dev team. It is derived from the real Excel workbook (`Trail.pdf` — sheets: Student Master, Combine Tracker, Total Fees, 154-Summary, Finance Pivot, Student Sheet, Hours Pivot) and is the single source of truth for what to build.

---

## 0. Mission

Build an **enterprise-grade Tuition Institute ERP** for a UAE-based tuition center that tracks **students, parents, teachers, lectures, prepaid hour packages, fee payments, and management analytics** from one platform. The current system is a fragile multi-sheet Excel workbook keyed on **Form No**; the software must replace it without losing any of its logic.

The product has **four role-based views**: **Student, Parent, Faculty, Management/Admin**.

---

## 1. Tech Stack (mandatory)

**Frontend**
- React.js + **TypeScript**
- **Tailwind CSS**
- React Hook Form + **Zod** validation
- Recharts (charts/KPIs)
- TanStack Query (server state) + Axios

**Backend**
- Node.js + **Express.js** + TypeScript
- JWT auth + **Role-Based Access Control (RBAC)**
- Zod (shared validation schemas between FE/BE)
- Prisma ORM (or Knex) over MySQL

**Database**
- **MySQL 8**

**Architecture**: API-first, REST, monorepo (`/client`, `/server`, `/shared`). Multi-branch ready.

---

## 2. CRITICAL business rules (these come from the real sheet — do not skip)

1. **Form No is the universal primary identifier.** Every student has a unique Form No. Lectures, fees, hours, and parents all link by Form No.
2. **Status is a 3-state enum, NOT a boolean:** `Active`, `Inactive`, `SP-Active` (special active). Store as enum.
3. **Currency is AED.** All money fields display/format as AED.
4. **Prepaid hours model.** A student buys a **package of hours** at a **rate per hour**. Lectures consume hours.
   - `Total Hours Credited = Hours Committed + Discount Hours + Adjusted Hours`
   - `Hours Left = Total Hours Credited − Total Hours Consumed`
   - **Hours Left CAN GO NEGATIVE** (e.g. −272.5). Negative = student has overconsumed → flag **"Payment Required"**. Never clamp to zero.
5. **Discount Hours / Adjusted Hours** are real columns — free/comp hours and manual corrections. Both must be editable by Admin and feed the formula above.
6. **Group lectures exist.** One lecture session can map to **multiple students** (in the sheet some rows have blank student names = combined classes). A lecture's hours are consumed per attending student.
7. **Hours per lecture = Time Out − Time In**, in decimal hours (e.g. 5:00 PM → 7:00 PM = 2.0; 1:30 duration = 1.5). Auto-calculate, but allow manual override (sheet has both "No of Hours" and rounded "No of Hrs").
8. **A student has MANY teachers; a teacher has MANY students** (e.g. Sofia is taught by Sachin Chawan, Chetan Masurkar, Prabhu Paul). Mapping is per **subject**.
9. **Fee status is derived:** `Pending Fees > 0` OR `Hours Left < 0` → **"Payment Required"**, else **"Active/Paid"**. Also track **Extra Amount Left** (credit balance).
10. **Everything is reported monthly** across a rolling timeline (sheet runs **Jun-25 → Aug-26**): revenue-per-student-per-month and hours-consumed-per-student-per-month pivots.

---

## 3. Data Model (MySQL)

Map directly from the workbook. Use the exact derived fields.

### users
`id, role (ENUM: student|parent|faculty|admin), email (unique), password_hash, is_active, branch_id, created_at, updated_at`

### students  *(from Student Master sheet)*
`id, form_no (unique), date_of_joining, status (ENUM: Active|Inactive|SP-Active),
first_name, middle_name, last_name, full_name (generated/derived),
year_grade (e.g. Y11, Y12, Y13), school_name, exam_board (IB|IAL|IGCSE|AQA|AS|A-Level...),
father_name, mother_name, relationship (ENUM: Father|Mother|Guardian),
email, dob, age, gender, nationality,
student_mobile, parent_mobile, extra_mobile,
fees_received (boolean/amount), form_received (boolean),
user_id (FK, nullable), branch_id, created_at, updated_at`

### parents
`id, student_id (FK), user_id (FK), name, mobile, relationship`

### teachers
`id, name, email, mobile, specialization, is_active, user_id (FK), branch_id`

### subjects
`id, name`   *(Chemistry, Physics, Maths, ...)*

### student_teacher_mapping
`id, student_id (FK), teacher_id (FK), subject_id (FK), package_hours (optional), created_at`
*(unique on student+teacher+subject)*

### lecture_sessions  *(from Combine Tracker / Student Sheet)*
`id, date, month (derived YYYY-MM), teacher_id (FK), subject_id (FK),
time_in, time_out, total_hours (decimal, auto = out−in), hours_rounded,
topic_remark, venue (JLT|Online|Oud Metha|...), branch_id, created_at`

### lecture_attendees  *(supports GROUP lectures — many students per session)*
`id, lecture_id (FK), student_id (FK), hours_consumed (decimal), attendance_status (ENUM: Present|Absent|Late)`

### fee_packages  *(from 154-Summary)*
`id, student_id (FK), package_hours, rate_per_hour, discount_hours,
adjusted_hours, course_name, start_date, is_active`

### fee_transactions  *(from Total Fees sheet)*
`id, student_id (FK), parent_name, amount (AED), payment_date, month (derived),
transaction_reference, payment_source (e.g. MASHQ bank transfer), notes (long text),
course_package_hours, created_by, created_at`

### student_hours_summary  *(from 154-Summary / Hours Pivot — can be a VIEW or materialized table)*
`student_id, hours_committed, discount_hours, adjusted_hours,
total_hours_credited (=committed+discount+adjusted),
total_hours_consumed (SUM of attendee hours),
hours_left (=credited−consumed, MAY BE NEGATIVE),
rate_per_hour, amount_credited, pending_fees, extra_amount_left,
fee_status (derived: 'Payment Required' | 'Active'),
last_attended_lecture_date`

### audit_logs
`id, user_id, action, entity_type, entity_id, before_json, after_json, created_at`

### branches  *(multi-branch support)*
`id, name, location, is_active`

> **Derived/pivot data** (Finance Pivot = revenue per student per month; Hours Pivot = hours per student per month) should be **computed via SQL GROUP BY**, not stored as columns.

---

## 4. The Four Views

### 4.1 STUDENT VIEW
- **Onboarding form** — student fills all Student Master fields (the basic-info form): Active/Inactive, First/Middle/Last → auto Full Name, Year, School, Exam Board, Father/Mother Name, Relationship, Email, DOB → auto Age, Gender, Nationality, Student/Parent/Extra Mobile.
- **Dashboard**: personal info, status, assigned teachers + subjects, current package, **Hours Purchased / Consumed / Remaining** (remaining shown red if negative), fee status, pending amount, recent & upcoming classes.
- **Lecture History**: Date, Teacher, Subject, Topic, Duration, Venue.
- **Fee Section**: payment history, pending fees, package details (read-only).
- **Profile**: update contact details, email, password.

### 4.2 PARENT VIEW
- **Login** linked to their child(ren).
- **Dashboard**: student details, attendance, lecture history, teacher info, fee status, remaining hours, pending payments.
- **Fees Section**: payment history, outstanding balance (AED), package summary, **a "Pay Now" button that is present but disabled / stubbed** — *do NOT integrate a payment gateway now; leave a clean integration point for Razorpay/Stripe later.*
- **Academic Progress**: teacher remarks, topics covered, performance, monthly reports.

### 4.3 FACULTY VIEW
- **Dashboard**: assigned students, today's classes, upcoming classes.
- **Student selection + assignment**: pick a particular student and record what the teacher teaches them (subject, package hours). A teacher may teach only one student or many — support both.
- **Lecture Entry**: Date, Time In, Time Out → auto Duration, Subject, Topic, Remarks, Venue. On save → **auto-decrement that student's remaining hours** (and each attendee's if group lecture).
- **Student Progress**: notes, homework, performance rating, attendance.

### 4.4 MANAGEMENT / ADMIN VIEW (super admin)
- **Student Analytics**: total / active / inactive / SP-active, new admissions, students by grade, by board.
- **Faculty Analytics**: total/active teachers, workload, students per teacher, hours taught (total + monthly + subject-wise).
- **Finance Dashboard**: total revenue, monthly revenue, outstanding fees, pending payments, collection trends, **Finance Pivot (revenue × student × month)**.
- **Hours Dashboard**: total purchased / consumed / remaining, **Hours Pivot (hours × student × month)**.
- **Student Ledger** (the 154-Summary screen): per student → Hours Purchased, Consumed, Remaining, Pending Fees, Last Lecture Date, Rate/hr, Discount/Adjusted hours, Extra Amount Left, fee status.
- **Student↔Parent↔Teacher mapping** management.
- **Reports / Export**: Student, Teacher, Finance, Attendance, Revenue, Hours-Utilization → **Excel, CSV, PDF**.

---

## 5. First-class modules pulled straight from the Excel

1. **Student Hours Ledger** — Hours Purchased, Consumed, Left (red if negative), Last Lecture Date, Rate/hr, Pending Fees.
2. **Lecture Tracker** — Time In, Time Out, Duration, Subject, Teacher, Topic, Venue; supports group sessions.
3. **Finance Tracker** — Transaction Reference, Payment Source, Parent Name, Notes, Amount (AED), Month.
4. **Teacher Workload Dashboard** — total students, total hours taught, monthly hours, subject-wise breakdown.
5. **Student Timeline** — chronological activity feed: admission → fee payments → lectures → teacher changes → notes.

---

## 6. UI / Design System

- Style: **modern SaaS dashboard** — Linear / Notion inspired, clean enterprise.
- **Dark + Light mode**, fully responsive, mobile-friendly.
- Components: data tables with filters + search + advanced pagination, charts, **KPI cards**, drawer forms, **multi-step forms** (student onboarding), calendar view (classes), **activity timeline**.

**Color tokens (use exactly):**

| Token | Light | Dark |
|---|---|---|
| Primary | `#2563EB` | `#3B82F6` |
| Background | `#F8FAFC` | `#0F172A` |
| Card | `#FFFFFF` | `#1E293B` |
| Text | `#0F172A` | `#F8FAFC` |
| Border | `#E2E8F0` | `#334155` |

**Dashboard KPI card accent colors:**
Students → Blue · Parents → Purple · Faculty → Emerald · Revenue → Orange · Pending Fees → Red · Hours Consumed → Indigo.

---

## 7. Additional features (build hooks now, full impl as noted)

Audit logs · notification system (email/SMS/parent/student alerts) · role permissions · **bulk import from Excel** (students, fees, lectures — must ingest the existing workbook format) · multi-branch · backup & restore · activity tracking · session recording links · **Google Meet / Zoom link storage** on lecture sessions.

> **Bulk Excel import is high priority** — the client already has months of data in the `Trail` workbook format and needs to migrate it in. Build importers that map the Student Master, Combine Tracker, Total Fees, and 154-Summary sheets onto the schema above.

---

## 8. Security & RBAC matrix

- JWT (access + refresh). Passwords hashed (bcrypt/argon2).
- **Student** → only own records. **Parent** → only their child(ren). **Faculty** → only assigned students + own lectures. **Admin** → everything + reports + imports + mapping.
- All mutations write to `audit_logs`.
- Validate every input with shared Zod schemas; parameterized queries only.

---

## 9. Deliverables / Definition of Done

1. MySQL schema + seed data (use the 6 sample students: Akanksha Mahapatra, Dhanvir Dhaval Jasani, Aadam Khalique, Nikita Jain, Kartik Raipancholia, Bora — including their negative-hours edge cases).
2. Express REST API with RBAC + Zod validation + audit logging.
3. React + TS + Tailwind frontend, all 4 views, dark/light.
4. Working hours-ledger math (incl. negative hours + discount/adjusted).
5. Group-lecture support.
6. Excel bulk-import for the existing workbook.
7. Reports export (Excel/CSV/PDF).
8. Payment "Pay Now" stub (no gateway yet) with a clean integration seam.
9. README with setup, env vars, and migration/import instructions.

**Edge cases to test explicitly:** negative Hours Left (Dhanvir −272.5, Kartik −113.1, Bora −1.5); SP-Active status; a student with 3 teachers (Sofia); a group lecture with multiple attendees; discount + adjusted hours changing the ledger; AED formatting; the Jun-25 → Aug-26 monthly pivots.
