# STEM Vision — tuition management system

A management system for a tuition institute in JLT, Dubai: students, the hours
they buy, the lectures they attend, the fees they pay, the teachers who teach
them.

Stack: Express + TypeScript + MySQL (`server/`), React + Vite + Tailwind
(`client/`), plain SQL, no ORM.

## Read this before working here

Full handover notes are in **`claude/`**, as plain text files:

| File | What it covers |
|---|---|
| `claude/00-README.txt` | what it is, how to run it, env keys |
| `claude/01-architecture.txt` | stack, folders, how a request flows |
| `claude/02-database.txt` | tables, relationships, migrations |
| `claude/03-hours-and-fees.txt` | **the money model — read before touching fees** |
| `claude/04-roles-and-permissions.txt` | the five roles, the permission switches |
| `claude/05-styling.txt` | design tokens, components, layout rules |
| `claude/06-conventions.txt` | the rules this codebase never breaks |
| `claude/07-api.txt` | every route and what guards it |
| `claude/08-features.txt` | QR check-in, lecture entry, fee imports |
| `claude/09-gotchas.txt` | **bugs that cost real time — do not repeat them** |

## The rules that matter most

1. **Nothing is ever deleted.** Every delete sets `is_deleted = TRUE`, and every
   read filters on it. Deleting a lecture must also stop its attendee rows from
   consuming hours.

2. **Everything runs on Dubai time.** The DB connection is `+04:00`, the server
   sets `TZ=Asia/Dubai` in `config.ts`, and the client reads `dubaiNow()` —
   there is no bare `new Date()` left in the client. Never use `toISOString()`
   to get a date; it is UTC regardless of TZ.

3. **Hours come from one place only:** a payment recorded in Finance. Nothing
   else may create them. A package with no `transaction_id` is suspicious.

4. **Every change is audited** with `audit(userId, ACTION, type, id, before, after)`.
   Where a user edit overwrites something the system recorded, the audit must
   carry the original.

5. **Hiding a button is not security.** Anything a role must not do is refused
   by the server as well. Locked buttons stay visible and explain who to ask.

6. **No horizontal scrolling, anywhere.** `table-fixed` + `<colgroup>`
   percentages on large screens, stacked below `lg`.

7. **Validate every request body with zod.** Be generous about what arrives,
   strict about what is stored.

8. **Comments explain why**, not what. Several are the only record of a decision
   the client made — don't strip them.

## Checks before committing

```
cd server && npx tsc --noEmit -p .
cd client && npx tsc -b && npm run build
```

There is no test suite. Changes that touch data are verified with a throwaway
script against the real API using `CLAUDETEST`-prefixed fixtures, cleaned up in
a `finally` block. `claude/06-conventions.txt` describes the method.
