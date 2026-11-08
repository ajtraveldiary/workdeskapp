# Attendance: one "Mark leave" pop-up and a cleaner register — plan

Status: **all three phases built** (2026-11-08: phase 1 on "Yes, start Phase 1", phases 2 and 3 on "go for remaining
phase"; the questions in section 7 were not answered, so every point of section 4 was built, the From date starts on
tomorrow from 4 pm and the morning notification is unchanged). Differences from the plan: register marks inside a new
leave are cleared by the app through `/attendance/clear` after the leave is saved (no `clearMarks` on the leave route);
leave days are whole days in the pop-up (half days on the Leave page); the leave band is a darker grey than holidays. Follows `docs/ATTENDANCE_PLAN.md`, `docs/ATTENDANCE_UX_PLAN.md`,
`docs/ATTENDANCE_ASSIST_PLAN.md` (the register, rules, Person days) and `docs/LEAVE_PLAN.md` (leave accounts, marking
leave). Items that change committed behaviour are marked **(changes committed: …)** and are covered by the user's
answers below unless marked **(needs a yes)**.

## 1. What the user said (2026-11-08)

"I want to make the attendance page and feature more useful for someone who manages the attendance register in an
office. Most employees call me and tell me their leave outside office hours. I want to remember them and update the
attendance register. I also want to avoid mistakes like not following the rules when marking offs for weekly-off
staff. Now attendance is not that useful and its UI is chaos. Attendance is a standalone feature with connections to
staff, leave etc. Don't show notifications in the To-do list or the Due Today list."

Answers to the questions asked the same day:

| Question | Answer |
|---|---|
| What happens with a call ("CL tomorrow") | **Mark it directly**, through a pop-up that makes marking easy: employee (drop-down), leave type (CL, CH, Off… or a leave such as HPL, commuted, EL), starting date, and number of days or ending date. **Prefix / suffix holidays shown automatically, only for HPL, commuted and EL types.** |
| A separate call log (how told, application received, late / permission) | No preference: **not built** (the mark itself is the record; History keeps who marked what and when) |
| A mark that breaks a rule | **Warn only** (as now; nothing is blocked) |
| Main screen | **The register, cleaned up** (no desk, no week grid) |
| Leave task when leave is marked from attendance | **Task as now** (the "Leave: <name>" task with its steps, shown in To-do and Due Today like any leave) |
| Where the pop-up goes | **Instead of the "Mark for someone" button** |
| CL / CH / Off over several days | **Skip holidays**: they fall only on the person's working days; EL / HPL / commuted count every calendar day, as KSR does |

"Don't show notifications in To-do or Due Today": attendance already shows nothing there since 2026-11-02, and this
plan adds nothing there. The only task is the leave task the user chose to keep.

## 2. The Mark leave pop-up (new) — `components/MarkLeave.tsx`

One form, a sheet on phones and a centred `Modal` on wider screens (a form: a tap outside doesn't close it).

```
 Mark leave                                                    ✕
 Employee   [ Mary Thomas · Staff Nurse            ▾ ]
            Weekly off · Day 5, off after 1 more day · CL 3 of 20 · CH 1 to take (by 15 Dec)
 Type       Register:  [CL] [½ CL] [CH] [Off] [OD] [Absent]
            Leave:     [EL] [HPL] [Commuted] [LND] [EOL] …        (permanent staff only)
 From       [Today] [Tomorrow]  [ 13/11/2026 ]
 Days       [ 3 ]   or  To  [ 16/11/2026 ]
 ─────────────────────────────────────────────
 Marks      Fri 13 · Sat 14 · Mon 16        (Sun 15: Sunday, skipped)
 ⚠ CL, CH and an off in one week (G.O.(Ms) 303/82)
 ⚠ Mon 16 already marked ✓ — it will be replaced
                                         [ Mark CL for 3 days ]
```

- **Employee**: everyone in the register (`inAttendance`), grouped by designation in their order; a search box on top
  of the list. Under it, one figures line: the day-off kind, for weekly-off staff Day N and `offStatus` words (with
  "take by" for an off owed), CL of the year, CH to take with the last day; for permanent staff the balance of the
  chosen leave type.
- **Type**: two rows of chips (own `type="button"` radios, not `Segmented`). Register marks: CL, ½ CL, CH, Off (only
  for weekly-off staff), OD, Absent. Leave: the account's active leave types from the Leave page (KSR types and the
  user's own), only for permanent staff (the Leave page is permanent-only); temporary staff see the register row
  alone.
- **From**: Today / Tomorrow chips and a date box. Starts on **tomorrow** from 4 pm (calls after office hours are
  about tomorrow), today before that.
- **Days or To**: typing one fills the other. For register marks the days are the person's **working days** (skipping
  holidays of the register, second Saturdays when they are holidays, and Sundays for Sunday-off staff:
  `offByItself`); the dates that will be marked are listed as chips with the skipped days named. ½ CL is one day.
  For leave types it is **calendar days** from–to (as the Leave page), half days allowed.
- **CH**: each chosen day gets the existing holiday-worked select (`ChChoose` logic from Person days: holidays that
  fit, oldest first, each once), with "+ Add a holiday worked" (`HolidayWorkedForm`) when none fits.
- **OD**: a remark box (kept on the mark, as now).
- **Leave types**: the balance before → after (the same figures and warnings as `LeaveDialog`: not enough balance,
  KSR limits, service limit), "On a medical certificate" when the type uses it, and **Prefix / Suffix** worked out
  automatically **only for EL, HPL and commuted** (KSR key `el`, `hpl`, `commuted`): the unbroken run of the person's
  days off by themselves just before the from date and just after the to date, e.g. "Prefix: Sat 14 Nov (Second
  Saturday), Sun 15 Nov (Sunday) · Suffix: none". Shown, and written into the leave's notes ("Prefix: …; Suffix: …")
  so the leave order has it. Order number / date and notes behind "More".
- **Already marked**: days in the range with another mark are listed and replaced on saving (Undo puts them back);
  days on leave from the Leave page are left out for register marks; for a new leave, register marks inside it are
  named ("Tue 17 marked ✓") and cleared when it is saved (so the register shows the leave, not a hidden ✓).
- **Warnings (warn only)**: every rule check the register and Person days already make, shown in an amber box
  before saving, each naming its rule: off taken early (`offsEarned`), past the most days in a row (`weeklyOff`),
  not eligible after a week away / off inside a week away (`longAwayDays`, `offsInLongAway`), CL, CH and an off in
  one week (`allThreeInAWeek`), CL past the year (`clPerYear`), CL / CH with holidays past 15 days (`CL_RUN_MAX`),
  CL / CH next to regular leave (`nextToLeave`), CH past the post's limit, no holiday worked open. Moved into one
  shared function (`markWarnings` in `src/shared/attendance.ts` or a client helper) so the pop-up, Person days and
  the register's bar say the same thing.
- **Save**: register marks through `POST /attendance/mark` (replace) and `/attendance/ch`, as Person days does;
  leave types through `POST /leave/leaves` (so the leave account line, the task "Leave: <name> — …" with its steps,
  History, the EOL date moves all happen as on the Leave page) with the step **"Mark in attendance"** (non-gazetted
  steps) already ticked, then the register marks inside it cleared. Undo in the Undo bar: register marks go back;
  a leave is cancelled (`POST /leave/leaves/:id/cancel`, days given back).
- **Open their month** link under the employee: opens Person days for day-by-day fixes (Person days loses its own
  button, below).

No new tables or routes are needed for marks; prefix / suffix is worked out in the browser from the month's holidays
(`GET /attendance/holidays?year=`) and settings. A small server change: `POST /leave/leaves` clears the person's
register marks inside the new leave (only when asked, `clearMarks: true`, so the Leave page keeps its behaviour).

## 3. Where it opens — **(changes committed: the "Mark for someone" button and the phones' + button)**

- The register toolbar's **Mark for someone** becomes **Mark leave** (primary, same place) and opens the pop-up.
- The phones' **+** on the Attendance page opens the pop-up too (it opened Person days).
- Person days stays (`openPersonDays`), reached from the pop-up's "Open their month" link and the figures pop-up
  (CL / CH cell) with a new "Mark days" button. The quick page `/markattendance` is unchanged.

## 4. The register, cleaned up — **(changes committed: the toolbar, legend and bar; needs a yes on each point)**

What makes it feel chaotic today: a toolbar of six controls, a paragraph-long legend always shown, small symbols in
every cell (blue / grey dots, red dots under days, dotted O, faint marks, red outlines, "+n", "Off in 4"), and a
selection bar that can grow many buttons and warning lines.

1. **Toolbar**: ‹ November 2026 › · This month · **Mark leave** (primary) · ⋯ menu (Summary, Download, Print,
   Holidays) · refresh. On phones: month, ⋯ and refresh in one row; Mark leave is the + button.
2. **Legend** behind a small **Key** button (a pop-up listing the marks with their colours), not a paragraph under
   the table. Print still prints the legend.
3. **Cells**: one colour per kind of mark, used everywhere (register, Person days, the pop-up chips): ✓ plain,
   O blue, CL amber, ½CL amber, CH purple, OD teal, H / SS grey, A red, leave a merged grey band with its short name.
   Future marks lighter (as Person days). The small markers stay but fewer: the holiday-worked dot stays; the red dot
   under a day becomes the day number in red (someone not marked); the red outline stays only for days past the most
   in a row.
4. **Name column**: name, then one short status line for weekly-off staff ("Day 5 · off in 1"), nothing else.
   The CL / CH cell shows "CL 3 · CH 1" only; "+n" and "Off in 4" move into its figures pop-up.
5. **Selection bar**: the marks that fit the selection only (as now), the warnings folded to one line
   "⚠ 2 rules ▸" that opens them (still warn only).
6. Checked at 375, 768, 1024, 1366 and 1920px, in dark mode, with long Malayalam names.

## 5. Not built (from the questions)

A call log (how / when told), tracking written applications, late / permission remarks, blocking rule breaks, a desk
or week-grid screen, any new line on Home, To-do or Due Today. The morning phone notification keeps its "Away today"
and "Off due" lines as now (tell us if those should go too).

## 6. Phases

1. **Mark leave pop-up with register marks** (CL, ½ CL, CH, Off, OD, Absent; working days; warnings; replaces Mark
   for someone and the phones' +; "Mark days" in the figures pop-up). Tests: day counting skipping holidays and
   Sunday-off Sundays, warnings shared with Person days.
2. **Leave types in the pop-up** (Leave page types for permanent staff, balance, prefix / suffix for EL, HPL,
   commuted, "Mark in attendance" ticked, `clearMarks`). Tests: prefix / suffix runs (holiday, second Saturday,
   Sunday for Sunday-off staff, none for weekly-off staff's Sunday), marks cleared inside a new leave.
3. **Register clean-up** (section 4).

Each phase: `npm run typecheck`, `npm test`, checks on the phone preset and desktop, docs (FILES.md, README.md,
CLAUDE.md), `CACHE_VERSION` only if API data changes shape.

## 7. Questions left

- Section 4: yes to every point, or which to leave out?
- The 4 pm switch to "Tomorrow" for the From date: right time, or always start on today?
- The morning notification's "Away today" / "Off due" lines: keep (assumed) or remove?
