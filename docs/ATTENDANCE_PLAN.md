# Attendance register — plan

Status: **Phases 1, 2 and 3 built** (2026-10-31; the user started Phase 1 with the recommended answers). Phase 1:
holidays and second Saturdays in Settings › Attendance, the register page (its look, selecting a day's column, a
person's month or cells, Present / Off / CL / ½CL / Absent / Clear, the year's CL and CH totals, the CL warning),
leave from the Leave page in its days, the phones' day view. Phase 2: CH tied to a holiday worked (the pop-up, 3
months, once each, the holiday's mark kept while its CH stands), CH limits by post and the 10-held warning, weekly-off
counting (offs due, days towards the next, more than 12 days in a row outlined), the 15-day CL / CH warning, and
starting figures; then (checked against this plan the same day) the 12-day warning before marking, CH due within a
week listed, the run shown, every figure reachable by tap and on phones, the weekly-off figures as settings,
starting figures from a CSV, and the 15-day check across the month's edges. Phase 3: the month's summary
under the register, Print (A4 landscape, with signature lines), the month's CSV, the register in the backup, "Attendance
not marked today" on Home's Today tab from 11 am, a line on the employee's page, and the assistant tools
`get_attendance` / `mark_attendance`. Written 2026-10-31.

The office keeps a daily attendance register for **every employee** (permanent and temporary), on a page that looks
like the paper register: one row per person, one column per day of the month. A whole day is marked for everyone
in one go (select the day's column, Mark present); a few cells can be selected and marked Off, Casual leave (CL) or
Compensation leave (CH). Leave marked on the Leave page (EL, HPL, commuted…) shows in the register by itself.
Holidays are set in Settings › Attendance. Weekly-off staff get their offs counted and are warned about long runs of
duty, and every CH is tied to the holiday it was earned on.

---

## 1. What the user asked for (2026-10-31)

- A new **Attendance register** page that looks like a page from an attendance register.
- Mark attendance of **all people for a day in one go**: select that day's column, click Mark attendance.
- Select cells and **Mark off**, **Mark casual leave**, **Mark compensatory leave** (CH) for a holiday worked: a
  pop-up shows the holidays the person can still take CH for.
- Columns: **Name | CL: 00 (total CL taken), CH: 00 (total CH taken) | 01 … last day of the month**.
- **Settings › Attendance** tab: mark the holidays of each month.
- **Weekly-off staff** (the Day off setting, 2026-10-31) have no Sunday off: 6 days of duty earn the 7th day off.
  They may work up to 12 days and then take the off and a C-off; someone who works 7 days and takes an off needs only
  5 more days for the next one. Everyone must take an off after 12 days: more than 12 days of duty in a row shows a
  warning.
- Work on a **second Saturday or a holiday** earns a **CH**, and every CH taken is mapped to the holiday worked.
- **Sync leave**: leave marked on the Leave page (HPL, commuted, earned…) shows in the register.

## 2. The rules, researched

Sources: Kerala Service Rules Part I, Appendix VII (casual leave, compensation leave) and the Health Department's
own order, **G.O.(Ms) No. 43/2021/H&FWD dated 17/02/2021** ("Compensation leave to Medical Officers and other
Hospital Employees", which replaced the earlier orders: G.O.(Ms) 303/82/HD, G.O.(Ms) 593/2008/H&FWD, G.O.(Rt)
3484/2010/H&FWD). No government order was found that fixes the weekly-off cycle for hospital staff, so the user's
rules in section 1 are used as given; every figure below is a setting the user can change.

### Casual leave (KSR Part I, Appendix VII, Section I)
- **20 days a calendar year** (teaching staff 15; not relevant here), also for staff with less than a year's
  service. Not an entitlement to the whole 20.
- **Half a day** may be taken (Rule 5).
- With Sundays and holidays before, between or after it, the absence may **not exceed 15 days in a row** (Rule 2(ii)).
- Not combined with regular leave (EL, HPL…) except as Heads of Department allow (Rule 6). Not counted as leave or
  absence from duty (Rule 1, 7). A Casual Leave Register (Form 19) is kept: the register's CL column is that.

### Compensation leave, CH (Appendix VII Section III, as relaxed for the Health Department by G.O.(Ms) 43/2021)
- **One day for each public holiday attended** on the orders of the head of office / controlling authority.
- How many a year, by category:
  - **Nursing staff:** as many as the holidays they were put on duty, **no yearly limit**.
  - **Hospital Attenders, Nursing Assistants, Hospital Workers:** up to **45 days** a year.
  - **Medical Officers in charge of PHC / CHC / FHC:** up to **15 days** a year (heads of office get CH only by
    this relaxation).
  - **All other hospital employees:** up to **22 days** a year.
- Taken only with the **prior permission** of the authority that grants casual leave.
- Must be taken **within three months** of the holiday worked; after that it lapses.
- Not **accumulated beyond 10 days**.
- May be combined with **casual leave or holidays**, but the total absence may **not exceed 15 days**.
- **Not combined** with regular leave (EL, HPL…).
- Not earned for a holiday spent **on tour** on duty.
- Not a right: given at the head of institution's discretion, after arranging the hospital's work.

### Holidays
- Kerala Government offices are closed on **Sundays, the second Saturday of every month and the gazetted public
  holidays** (22 general holidays notified for 2026). Some calendars also list the fourth Saturday; that isn't
  confirmed by an order, so it isn't assumed. The office marks its own holidays (section 6), with second Saturdays
  added automatically (a switch).

### Weekly off (the user's rules)
- A weekly-off employee earns **one off for every 6 counted days**; earned offs carry over (7 days worked, then an
  off, leaves 1 day towards the next, so 5 more days earn it).
- **Counted days** (user's answer 2026-10-31): days on duty (holiday duty included), **CL** (a half day CL day too)
  and **CH** days. **Regular leave** from the Leave page (earned leave, half pay leave, commuted leave, LND, EOL,
  maternity…) does **not** count.
- At most **12 counted days in a row** without an off; the 13th shows a warning on the row and in the day's marking.
- They have **no Sunday off**: Sundays are ordinary days for them. A **public holiday or second Saturday** worked
  earns a **CH**, like anyone else.

## 3. Marks in a cell

| Mark | Shown | Meaning | Who sets it |
|---|---|---|---|
| Present | ✓ (a tick, like a signature) | On duty | Mark present |
| Half day CL | ½CL | Half a day of casual leave, the other half on duty | Mark casual leave › Half day |
| Casual leave | CL | Casual leave | Mark casual leave |
| Compensation leave | CH | CH for a holiday worked (the holiday is kept with it) | Mark CH (pop-up) |
| Weekly off | O | The weekly off (weekly-off staff) | Mark off |
| Absent | A | Absent without leave (to be regularised) | Mark absent (suggested, Q4) |
| Holiday | grey column, "H" / "S" | Sunday (Sunday-off staff), second Saturday or a holiday in Settings | Automatic |
| Leave | EL, HPL, Commuted, LND, EOL, ML… | Leave from the Leave page (`employee_leaves`), its short name | Automatic, read-only |
| Not in office | dashes | Before joining this office / after leaving it | Automatic |
| Not marked | empty | A working day nobody has marked yet | — |

- **Present on a holiday** (a public holiday or second Saturday in Settings › Attendance) is **holiday duty**: the
  cell shows ✓ on the grey column with a small "CH" dot, and it earns one CH. A **Sunday worked by Sunday-off staff
  doesn't** (user's answer 2026-10-31): only holidays earn CH.
- A cell covered by leave from the Leave page can't take another mark; the leave is changed on the Leave page.
- Marks are saved straight away; each action is **one History entry** ("Attendance 31 Oct 2026: present 14, off 2,
  CL 1"), not one per cell.

## 4. The register page (`/attendance`)

Looks like a ruled register page on computers:

```
                       ATTENDANCE REGISTER — <office name from Settings › General>
                                         October 2026                    ‹ Month ›  Print
┌────┬──────────────────────────┬─────────────┬──┬──┬──┬──┬──┬──┬── … ──┬──┐
│ Sl │ Name / designation       │ CL   CH     │01│02│03│04│05│06│       │31│
│    │                          │             │Th│F │Sa│Su│M │T │       │Sa│
├────┼──────────────────────────┼─────────────┼──┼──┼──┼──┼──┼──┼── … ──┼──┤
│  1 │ Anitha Kumari R          │ CL 03 CH 01 │✓ │✓ │H │S │✓ │CL│       │  │
│    │ Junior Health Inspector  │             │  │  │  │  │  │  │       │  │
│  2 │ Mary Thomas (weekly off) │ CL 00 CH 02 │✓ │✓ │✓•│✓ │O │EL│       │  │
└────┴──────────────────────────┴─────────────┴──┴──┴──┴──┴──┴──┴── … ──┴──┘
```

- Heading in the register's style (a serif title, the office name, the month), ruled lines, numbered rows. People are
  in designation order then name (as the Employees list), permanent then temporary, with "(weekly off)" by the name of
  weekly-off staff; those not in the office that month aren't listed.
- **CL / CH column:** CL taken this calendar year (half days count ½) and CH taken this year, each with its limit on
  hover / tap ("CL 3 of 20"; "CH 1 · 2 available"). Weekly-off staff also show **offs due** ("Off 1 due").
- **Day columns:** day number and weekday letter; Sundays (for Sunday-off staff' cells) and holidays shaded grey with
  the holiday's name on hover; today outlined. The month's own last day ends it (28 to 31 columns).
- **Selecting:** tap a **day's header** to select the whole column (everyone); tap cells to add or remove them; drag
  (mouse) or shift-click for a range; tap a **name** to select their row for the month. Esc / Clear empties it.
- **Action bar** (sticky at the bottom while something is selected): **Mark present**, **Mark off**, **Mark CL**
  (Full / Half day), **Mark CH**, **Absent** (Q4), **Clear marks**, and "n cells selected". Only the actions that fit
  are shown (Mark off only for weekly-off staff; holiday cells take Present only, as holiday duty).
- **Mark present on a column** fills only cells that are empty: leave, CL, CH and offs already there stay.
- **Mark CH pop-up:** per selected person, the holidays they worked whose CH is still open, oldest first, each with its
  date, name and "expires on" (holiday + 3 months); one is ticked to start (the oldest). Nothing to take → "No
  holiday duty to take CH for", and the person is left out. With several days selected for one person, one holiday
  per day.
- **Warnings** (never stopping the marking, like leave's KSR warnings) shown in the action bar before marking and as a
  red mark on the row: more than 12 days of duty in a row; an off taken with none earned; CL past 20 this year; CL /
  CH with the holidays around it past 15 days in a row; CH past the person's yearly limit or 10 held at once; a CH
  expiring within 7 days ("take it by 5 Nov").
- **Not marked yet:** a past working day with empty cells shows a small count in its header ("3 not marked"); Home's
  Due Today could carry "Attendance not marked for today" (Q5).
- **Print:** A4 landscape, the page as it looks, with signature space (Q6).
- **Phones (under 768px):** a month of 31 columns doesn't fit, so phones show **one day at a time**: the date with ‹ ›,
  everyone listed with their mark as a chip, "Select all" + the same action bar; tapping a name shows their month as a
  small calendar. Tablets get the register with the name column frozen and the days scrolling sideways.

## 5. Weekly-off counting

For a weekly-off employee, from their **starting figures** (section 7) or the first day marked (user's answer
2026-10-31):
- **Counted days** = days present (holiday duty included), CL and half-day CL days, and CH days.
- **Not counted:** regular leave from the Leave page (EL, HPL, commuted, LND, EOL, maternity…), absent days, and
  holidays not worked (to confirm, Q3a).
- **Offs earned** = floor(counted days ÷ 6); **offs due** = earned − offs taken (O marks). The days carried over are
  shown as "4 days towards the next off".
- **Run** = counted days in a row since the last off; an off ends it, and so does a stretch of regular leave (to
  confirm, Q3b). Run > 12 → warning.
- Marking O with no off due warns ("No off earned yet: 4 days of 6").
- The page shows, per weekly-off person, "Off due" and the run of duty so far, so the user can plan their offs.

For **Sunday-off staff** Sundays and holidays are off by themselves; no off counting.

## 6. Holidays — Settings › Attendance

- A new **Attendance** tab (`#attendance`, after Leave): a month calendar with ‹ ›; tap a date to make it a holiday
  and give its name (Onam, Christmas…), tap again to change or remove it. A list of the month's holidays under it.
- **Second Saturdays are holidays** (switch, on to start): every second Saturday shows as a holiday without being
  added.
- Per designation, the **CH yearly limit** by G.O. 43/2021 (user's answer 2026-10-31): No limit (nursing staff) / 45
  (hospital attenders, nursing assistants, hospital workers) / 15 (MO in charge of a PHC, CHC or FHC) / 22 (all
  others, the starting value). Common Kerala Health Services posts are filled in from their names (Staff Nurse,
  Nursing Officer… → no limit; Hospital Attendant, Nursing Assistant… → 45); each can be changed.
- The **casual leave days a year** (20) and the **weekly-off figures** (6 days for an off, 12 days at most) as
  settings.
- The **starting figures** card (section 7).
- Later: "Add the year's public holidays" from a list pasted or a CSV.

## 7. Starting figures (when the register starts mid-year)

Per employee, once (user's answer 2026-10-31): CL already taken this year; holidays already worked with CH still
open (date + name, within 3 months); for weekly-off staff, offs due and days towards the next off; and the date the
figures are as on. Entered in Settings › Attendance or from a CSV.

## 8. Leave sync (user request 2026-10-31)

- Every **active leave** from the Leave page (`employee_leaves`, not cancelled; from `fromDate` to its end, `leaveEnd`,
  so an early rejoining shortens it) fills its days with its **short name** (EL, HPL, Commuted, LND, EOL, ML, PL…),
  read-only. Changing, cancelling or rejoining a leave changes the register at once (it is read, not copied).
- Those days are **not on duty**, don't count towards a weekly-off employee's next off (user's answer 2026-10-31)
  and don't count as CL or CH.
- Marking leave over days that already have marks: the leave wins in the register; the old marks are kept underneath
  and shown again if the leave is cancelled (so nothing is lost). Mark leave warns "3 days have attendance marks".
- The leave's own task and steps are unchanged.
- Later (suggestion): a CL day can be turned into leave from the register ("Convert to leave…" opens Mark leave
  with the dates).

## 9. Data and routes

- `holidays` (`userId`, `date` unique per user, `name`, `kind` public / local; created / updated) — second Saturdays
  are worked out, not stored (with the switch `attendance_settings.secondSaturday`).
- `attendance_marks` (`userId`, `employeeId`, `date`, `mark` present / off / cl / cl_half / ch / absent,
  `chHoliday` date for a CH, `note`; unique per employee and date; deleted with the employee).
- `attendance_settings` (one row per user, jsonb like office details: second Saturday switch, CL days, weekly-off
  figures, CH limits per designation, starting figures).
- Worked out, not stored: holiday duty (present on a holiday), CH open (holiday duty not yet mapped by a CH, within 3
  months), offs due, runs of duty, totals.
- Routes `routes/attendance.ts`: `GET /attendance?month=YYYY-MM` (employees in the office that month, their marks,
  holidays, leave days from `employee_leaves`, totals, warnings), `POST /attendance/mark` (`{employeeIds, dates,
  mark, chHolidays?}`, bulk, one History entry; refuses cells covered by leave), `POST /attendance/clear`,
  `GET /attendance/ch/:employeeId` (open holidays), `/holidays` CRUD, `GET/PUT /attendance/settings`.
- Neon: bulk upserts, one request per action (Worker subrequest limit).
- In the backup (`holidays`, `attendanceMarks`, `attendanceSettings`); an Attendance CSV export of a month (one row
  per person, a column per day, like the page).
- `CACHE_VERSION` bumped; History entries `attendance.*`; covered by `tests/attendance.test.ts`.

## 10. Screens list

- `/attendance` page (`pages/Attendance.tsx`): "Attendance" in the sidebar (Office group, after Leave), the phone
  profile panel and the account menu; icon `ClipboardCheck`.
- Settings › Attendance tab (`components/AttendanceSettings.tsx`).
- `components/AttendanceGrid.tsx` (the register, selection, action bar), `components/ChPicker.tsx` (the CH pop-up),
  phones' day view.
- Employee page: an "Attendance this month" line (present / CL / CH / offs due), opening the register on them.

## 11. Suggestions (not asked for)

1. **Monthly summary** at the foot of the register: days present per person, CL, CH, leave, absent — the figures
   for the salary / SPARK attendance.
2. **Lock a month** once it is checked, so old marks can't change by mistake (Unlock asks).
3. **Duty roster** for weekly-off staff: plan the offs ahead (planned offs shown dotted), then mark them taken.
4. **Assistants:** "mark everyone present today", "who is on CL today", "how many CH does Mary have" (read tools +
   a staff action, logged like the others).
5. **Late / early** marks (time in) if the office records them.

## 12. Questions

Answered by the user (2026-10-31):
- **Weekly off:** duty days, CL and CH (and the like) count towards the next off; commuted leave, half pay leave,
  earned leave and the other regular leave don't.
- **Sunday duty:** Sunday-off staff earn CH only for holidays, not for a Sunday worked.
- **CH limits:** by designation, as in G.O.(Ms) 43/2021/H&FWD.
- **Starting figures:** entered per employee.

Still to confirm (recommended answers):
1. **Look:** a ruled register page as drawn in section 4, with ✓ for present (or initials / "P")? ✓ recommended.
2. **Who is listed:** every employee in the office that month, permanent and temporary? Yes.
3. Weekly off details: (a) a holiday a weekly-off employee doesn't work counts towards the next off like CL? Yes;
   (b) does regular leave reset the run of days to 12, or only pause it? Reset (they were away).
4. **Absent mark (A)** for absence without leave? Yes, not counted.
5. **Home reminder:** "Attendance not marked for today" on Due Today from 11 am? Yes.
6. **Print** the month (A4 landscape) for signatures? Yes.
7. **Warnings only** (like leave), never blocking? Yes.

## 13. Phases

1. **Holidays and the register:** Settings › Attendance (holidays, second Saturdays), the `/attendance` page with
   the register look, column / cell selection, Mark present / off / CL / clear, CL totals, leave from the Leave page
   in the cells, phones' day view. About 1 session.
2. **CH and weekly off:** holiday duty, the CH pop-up mapped to a holiday, CH totals, limits and the 3-month expiry,
   weekly-off counting (offs due, runs of duty, the 12-day warning), the 15-day CL + CH warning, starting figures.
   About 1 session.
3. **Extras:** print, the monthly summary, backup and the month's CSV, Home reminder, employee page line, assistants.
   About half a session. **Built** 2026-10-31.
