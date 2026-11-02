# Attendance that assists the register keeper — plan

Status: **phase 1 built** (2026-11-02, the user said "Yes, start Phase 1"; settled: three weeks in Person days, the
+ button on the Attendance page only; Today's "Select everyone" became "Tick the other n present" since the circle now
ticks). Phases 2 (away today / tomorrow) and 3 (absence statement) not built. Follows `docs/ATTENDANCE_PLAN.md` (the register) and
`docs/ATTENDANCE_UX_PLAN.md` (Offs board, Today tab, Start the register, planned offs: all built). Items that change
committed behaviour are marked **(changes committed: …)** and need the user's yes, as CLAUDE.md requires.

## 1. What the user said (2026-11-02)

"The attendance UI is not yet useful. I am maintaining the attendance register of the office, so this app must assist
me in that. When someone says *I am off tomorrow and CL on the day after*, I should mark it."

Answers to the questions asked the same day:

| Question | Answer |
|---|---|
| How to enter "off tomorrow, CL the day after" | **Pick the person, tap the days** (a strip of their coming days, tap a day, choose the mark) |
| Where marking happens | **Phone and computer equally** |
| Daily habit | **Tick everyone daily**, one person at a time (not pre-filled, not assumed) |
| A future off / CL | **Saved as the mark straight away** (shown lighter until the day comes), changeable any time |
| Month-end printout | **Both**: the register grid and an absence statement |
| Assist with | **Who is away today / tomorrow**, **warn while I enter**, **month-end register**, **remind about offs** |
| Staff cover warnings | **None** (only the rule warnings) |

## 2. What is wrong now

1. **No place to enter a person's coming days.** "Off tomorrow, CL Thursday" needs the Register grid (computer only)
   or the `/markattendance` page (hidden, one kind of mark at a time). The Offs board only has "Off today" and Plan off.
2. **Ticking the day is slow.** In Today, the row's circle *selects* and the row opens a menu; ticking 15 people
   present means select, select, select… then the bar. There is no "12 of 16 ticked" progress.
3. **"Days not marked count as duty" is on**, which hides who hasn't been ticked; the user ticks every day.
4. **Nobody can see at a glance who is away today and tomorrow.**
5. **Warnings come after saving** (in the Undo bar), not while choosing.
6. **No absence statement** for the month.

## 3. The design

### 3.1 Person days (the main entry) — new

One screen for one person, the same on phone and computer (a sheet on phones, a side panel on computers):

```
 Mary Thomas · Staff Nurse · weekly off            Day 5 · Off after 1 more day
 ‹  Mon 2 Nov – Sun 22 Nov  ›
 ┌───┬───┬───┬───┬───┬───┬───┐
 │M 2│T 3│W 4│T 5│F 6│S 7│S 8│   ← today outlined; past days solid, future lighter
 │ ✓ │ O │CL │   │   │   │   │
 ├───┼───┼───┼───┼───┼───┼───┤
 │M 9│…  three weeks, Mon–Sun rows                                   │
 └───────────────────────────┘
 Tap days (several at once), then:  [Present] [Off] [CL] [½CL] [CH…] [Absent] [Clear]
 ⚠ Off on Tue 3: 1 day before it is earned (taken early)
 CL 3 of 20 · CH 1 of 22, 1 to take (Onam, by 15 Dec) · Last off Tue 27 Oct
```

- **Opened from anywhere:** a person's name in Today, the Offs board, the Register (tap the name), the employee page,
  and a **+ button** on the Attendance page (phones: floating; computers: "Mark for someone") that first asks *who*
  (a search box over everyone in the office, designation order).
- **Three weeks** starting this week (Mon–Sun rows), ‹ › for earlier or later weeks; holidays shaded with their
  name, leave from the Leave page shown and not tappable.
- **Tap days to select** (several), then a mark button; saved at once, Undo puts back what was there. Future marks
  are real marks (user's answer), drawn lighter until their day.
- **Warnings before saving** (the user's "warn while I enter"): the mark buttons say what would happen for the days
  chosen — "Off · 1 day early", "CL · 21 of 20", "CH · no holiday worked open", "past 12 days in a row",
  "CL + holidays 16 days in a row". Nothing is blocked.
- **CH…** opens the existing holiday picker for the chosen days.
- The figures line (CL, CH, offs, last off) and, for weekly-off staff, Day N and the status.

### 3.2 Today: tick each person — **(changes committed: the Today tab's row tap and tick)**

- Each row's circle **is the tick**: tap = Present (saved at once), tap again = clear. No more selecting first.
- Tapping the **name** opens Person days (3.1) for anything else (off, CL…).
- A people already marked off / CL / CH / on leave show their mark and need no tick.
- A **progress line** at the top: "12 of 16 ticked · 2 off · 1 CL · 1 on leave", turning green when everyone is done.
- Keep **Select everyone** and the bottom bar for marking many at once (e.g. a whole day present).
- Home's "Attendance not marked today" (from 11 am) comes back.

**Days not marked count as duty** is switched **off** (user's answer: ticks every day) — the default changes to off
**(changes committed: `assumeDuty` default on, 2026-11-02)**; the switch stays in Settings.

### 3.3 Away today and tomorrow — new

- **At the top of Today** (and as a line on Home's Due Today Today tab): two short lists —
  **Today**: Mary (Off), Anitha (CL), Rajesh (EL till 14 Nov); **Tomorrow**: Priya (Off), …
  Tap a name for Person days.
- The **morning notification** adds "Away today: Mary (Off), Anitha (CL)".
- **CH about to lapse** (within 7 days) is listed under it, as now in "CH to take within a week".

### 3.4 Month-end — the grid and an absence statement

- **Register grid print** (exists): kept, with the lighter future marks printed normally, and the legend tidied.
- **Absence statement** (new; Register tab › Statement, print and CSV): one block per person with any absence:
  "CL: 3, 4 Nov (2) · ½CL: 18 Nov (0.5) · Off: 5, 12, 19, 26 Nov (4) · CH: 9 Nov for Onam (1) · EL: 10–14 Nov (5) ·
  Absent: —", totals, then Prepared by / Verified by / Head of Office. Day ranges joined ("10–14 Nov").

### 3.5 Offs reminders — kept

The Offs board, Day N, Plan off, Home's "Off due" line and the morning note stay as they are. Its person sheet gets
"Mark days…" opening Person days.

### 3.6 Not doing (user's answers)

- No staff-cover warnings (minimum per post).
- No sentence entry ("Mary off tomorrow") for now; Person days is the way in.
- No pre-filled "confirm today".

## 4. Data and server

- No new tables. Future dates already take marks; `POST /attendance/mark` and `/attendance/ch` are used as they are.
- New `GET /attendance/person/:id?from=` — one person's 3 weeks (marks, leave, holidays, planned offs), figures (CL,
  CH open, weekly-off status) and **what each mark would cause** on the days given (`POST /attendance/check`
  `{employeeId, dates, mark}` → warnings), so the buttons can show warnings before saving; the same rules as the
  register's bar (`offsEarned`, CL a year, `CL_RUN_MAX`, `maxRun`, CH open).
- New `GET /attendance/away?days=2` — who is away today and tomorrow (marks off / CL / ½CL / CH / absent and leave
  from the Leave page), used by Today, Home (`Summary.awayToday`) and the morning notification.
- `assumeDuty` default **false**; `unmarkedToday` works again while it is off (it already does).
- Absence statement built in the browser from the month (`AttendanceMonth`), printed and saved as CSV.
- `CACHE_VERSION` bump; tests for the check route, the away list and the statement grouping.

## 5. Phases

1. **Person days + ticking Today** (3.1, 3.2): the Person days sheet with warnings before saving, the + button and
   who-picker, names opening it everywhere, the tick-to-mark rows with progress, `assumeDuty` off by default.
   About one session.
2. **Away today / tomorrow** (3.3): the lists in Today, the Home line, the morning notification, CH lapsing.
   About half a session.
3. **Absence statement** (3.4): Statement in the Register tab, print and CSV; the grid's legend and future marks.
   About half a session.

## 6. Still to confirm

1. Person days shows **3 weeks** from this week — enough, or a whole month?
2. On phones, should the **+ button** be on the Attendance page only, or also on Home?
3. The absence statement: **every person** (with "No absence" rows) or **only people with an absence**?
