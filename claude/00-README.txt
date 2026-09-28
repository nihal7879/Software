================================================================================
STEM VISION - TUITION MANAGEMENT SYSTEM
Handover notes for a developer (or an AI assistant) new to this codebase
================================================================================

WHAT THIS IS
------------
A management system for STEM Vision, a tuition institute in JLT, Dubai.
It tracks students, the hours they buy, the lectures they attend, the fees they
pay, and the teachers who teach them.

The institute used to run on Excel sheets. Much of the design deliberately
mirrors those sheets, because the staff already know them - the lecture entry
screen is a row you fill across, not a form.

Users of the system:
  - Super admin : the owner. Everything, including money reports.
  - Admin       : the office. Day to day running, no money overview.
  - Faculty     : teachers. Their own students, lectures and attendance.
  - Student     : their own hours, fees, lectures, and QR check-in.
  - Parent      : the same, for their children.


READ THESE IN ORDER
-------------------
  00-README.txt            this file - what it is, how to run it
  01-architecture.txt      stack, folder layout, how the two halves talk
  02-database.txt          tables, relationships, migrations
  03-hours-and-fees.txt    the money model - READ THIS BEFORE TOUCHING FEES
  04-roles-and-permissions.txt   who may do what, and the permission switches
  05-styling.txt           design tokens, component library, layout rules
  06-conventions.txt       the rules this codebase follows without exception
  07-api.txt               every route, what guards it
  08-features.txt          how the bigger features actually work
  09-gotchas.txt           bugs that cost real time - do not repeat them

If you only read two: 03-hours-and-fees.txt and 06-conventions.txt.


RUNNING IT
----------
Requirements: Node 20+ (developed on 24), MySQL 8, npm.

  cd server && npm install && npm run dev     # http://localhost:4000
  cd client && npm install && npm run dev     # http://localhost:5173

The client proxies /api to the server in development (see client/vite.config.ts).

server/.env holds the configuration. The file is NOT in git. Ask the office for
a copy, or build one with these keys:

  PORT                 4000
  CLIENT_ORIGIN        http://localhost:5173
  DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME
  JWT_SECRET           any long random string
  JWT_EXPIRES_IN       1d
  SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS MAIL_FROM
  ADMIN_NOTIFY_EMAIL   who is told when a student registers
  APP_URL              the link used in emails
  ASSEMBLYAI_API_KEY   speech to text (feature currently hidden)
  TZ                   Asia/Dubai

While the SMTP keys are placeholders, nothing is actually emailed - the message
is recorded in the email_log table instead. That is intended behaviour, not a
bug.


DATABASE SETUP
--------------
  cd server
  npm run db:migrate      # runs database/schema.sql
  npm run db:seed         # runs database/seed.sql

Then apply everything in database/migrations/ in filename order. They are dated
and are meant to be run once each, oldest first.

NOTE: the live database is named `classroom_app`; schema.sql says `tuition_erp`.
The migrations use `classroom_app`. Check which one you are pointed at before
running anything.


WHERE THINGS ARE HOSTED
-----------------------
  Client + server : Vercel
  Database        : a machine on the office network (not a managed service)

Vercel runs on UTC and will not let you set a TZ environment variable - the name
is reserved. The app sets its own timezone in code instead. See 06-conventions.


BUILD CHECKS BEFORE YOU COMMIT
------------------------------
  cd server && npx tsc --noEmit -p .
  cd client && npx tsc -b && npm run build

There is no automated test suite. Changes that touch data are verified by
writing a throwaway script against the real API with CLAUDETEST-prefixed
fixtures, then deleting them. See 06-conventions.txt for how that is done.
