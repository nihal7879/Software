# What's New — Product Update (Today)

A complete list of everything added, improved, and fixed today, by feature.

---

## Lectures
- **Lecture date is now a calendar picker.** Teachers select the date instead of typing it, so lectures always save correctly and appear on the admin side.
- **Fixed: lectures no longer go missing.** A wrongly-typed date previously could fail to save or not show up for admins — now prevented.
- **Admin can log a lecture for a teacher.** On the **Teachers** page, "+ Lecture" next to any teacher lets an admin record a class on the teacher's behalf when they're busy (attendees come from that teacher's students).

## Student Hours Statement
- **"Used Hours" renamed to "Total Hours Delivered"** for clearer wording.
- **"Payment Required" now shows as soon as hours reach zero** (not only when they go negative).
- **All hours and amount columns right-aligned** with the totals lined up, plus a clean **Total** row at the bottom — reads like a proper statement.

## Finance / Payments
- **Discount Hours** can now be entered on a payment and are automatically added to the student's hours balance and statement.
- A **Disc Hrs** column was added to the payments table, and discount hours can be set on imported payment drafts too.
- **Fixed: editing a payment no longer throws an error.**
- **Fixed: deleting a payment now also removes the hours it had credited**, so balances stay correct.
- **Imported payment details are locked** (Date, Transaction, Reference, Credit, Source) so the original values can't be changed by mistake while assigning a student.
- The **Delete** button was removed from the payments list.
- Money and hours columns right-aligned for readability.

## Profiles
- **School, Exam Board, and Year/Grade are now dropdowns** (you can still type a custom value).
- **All profile fields are now required** except the extra mobile number, so records stay complete.
- The **Student Profile** is now a single clean page, and changing password moved to Settings.

## Settings (new)
- **Every user — Admin, Teacher, Parent, Student — now has a Settings page** to change their own password.

## Teachers
- **Fast teacher search** in the Teachers workload list.
- **"+ Lecture"** option to log a class for a teacher (see Lectures above).

## Faculty (Teacher) view
- When a teacher opens a student, they now see only the relevant teaching details and a **total of hours taught**, without the student's billing/package information.

## Reports & Pivots
- **Pivot reports** are available to analyse the data across different breakdowns — including **fees and teacher** views — so management can slice students, hours, and payments by the dimensions they need.
- Figures in these reports follow the same clean, right-aligned number formatting as the rest of the app.

## Across the App
- **All money and hours figures are right-aligned with aligned digits** — Finance, Student Hours, Hours Statement, Teachers, Student & Parent dashboards, Tracker, and lecture logs.
- **Performance improvements for scale:** long lists (students, payments, hours) now load in pages, and searching for students and teachers is fast and instant — the system stays responsive as records grow.

## Speak the lecture remark
- The **Remark** box on a lecture now has a **Speak** button — press it and talk, and the words appear in the box **as you say them**. Press stop when you are done. It works when logging a class (teacher or admin) and when editing one.
- Anything already typed is kept; what you say is added to the end, and you can still edit it before saving.
- Nothing is recorded or stored — the audio is turned into text as you speak and is not kept.
- Useful straight after a class, especially on a phone.

## Hours adjustments: a date, and a way to correct them
- **Adjust Hours now takes an optional date** — the day the adjustment is *for*, which is often not the day you type it in. An entry like "adjusted till 16 May" made in September now sits on the statement in May, so the running balance reads correctly from that point on. Left empty it behaves exactly as before.
- **Adjustment lines on the statement can be edited or deleted.** Hover a "Hours adjusted" row and use the pencil or bin — change the figure, the note or the date, or take the entry off entirely. The balance updates straight away.
- Only adjustment rows work this way: a package follows its payment, and a lecture is edited where it was logged.
- A deleted adjustment is kept on record, like everything else.

## Nothing is ever really deleted
- **Every delete in the app is now a "soft" delete.** When a lecture, a payment, a student, a follow-up note, or a student taken off a lecture is removed, the record is marked as removed and kept in the database — it simply stops showing anywhere in the app.
- This means a mistaken deletion can always be looked up and put back, and the audit log still records who removed what and when.
- Figures stay correct throughout: a removed lecture or a student taken off a lecture no longer counts towards consumed hours, so the hours return to the student immediately.

---

*Thank you — please share any questions or feedback.*
