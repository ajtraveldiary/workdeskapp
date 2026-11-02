# Attendance, made easy — plan

Status: **Phases 1, 2 and 3 built** (2026-11-02, the user started them with the recommended answers: early offs allowed
with a warning, the second off after 12 days is a second off owed, red from 2 owed, the page opens on Offs; days not
marked count as duty, from each person's starting point only, so nobody new shows weeks of duty; Start the register
asks for the last off; phones have Offs and Today, computers also the Register; planned offs are a table of their own,
turned into off marks on their day, and must be after today: today's off is marked directly). Written 2026-11-02 (user request: "attendance is only half baked, user experience is
horrible; make a plan for better UI and experience"). It builds on the register from `docs/ATTENDANCE_PLAN.md`
(phases 1–3 built). Several items below **change committed behaviour**; they are marked **(changes committed: …)**
and wait for the user's yes, as CLAUDE.md requires.

---

## 1. What the user wants (2026-11-02)

- Attendance is **mainly for reminding weekly-off staff to take their off**: an off after 6 days of duty, and if
  someone works 12 days without a break, the off **and a compensatory off** are due.
- **People don't follow the rule to the letter**: an off a day early or late, two offs together, a swap with a
  colleague. The app must bend with them and **warn, not block**.
- **When the register starts, everyone already has a position**: some have offs owed, some have worked 4 days since
  their last off. Setting that up must be quick.
- **The cycle carries over**: someone who works 7 days and then takes an off needs only 5 more days for the next one.
- **An off can be on a Sunday** (user, 2026-11-02): for weekly-off staff a Sunday is an ordinary day, so their off
  may fall on it like any other day. That Sunday off **is** their weekly off, not an extra holiday (G.O. 161/08:
  weekly off and the Sunday holiday not both in one week). Plan off suggests Sundays like any day, and Sunday cells
  of weekly-off staff are never greyed out.
- Research these aspects (section 2).

## 2. Research

### Kerala rules
- **No Health Department order on the weekly-off cycle was found online.** The nearest is **G.O.(Ms) No. 161/08/AD
  dated 27.09.2008** (Animal Husbandry), issued to give veterinary hospital staff weekly off "on par with the
  hospital employees of H & FW Department", so it most likely copies the Health Department's rule. It says (from the
  AHD Manual and a copy of the order; to be checked against the original):
  - In a week, **the seventh day is off** after six days of duty.
  - **CL or compensation leave taken during the six days counts as duty** for the weekly off (WorkDesk already
    counts them).
  - **Weekly off and the Sunday holiday can't both be had in one week**: weekly-off staff don't get Sundays (as
    WorkDesk does now).
  - **CL, CH and weekly off taken at a stretch for a week or more**: no weekly off for that week.
  - The **head of the institution grants** the weekly off, so that the work isn't disrupted. In other words, the
    exact day is the office's choice, which is why flexibility matters.
- A Health Department order for residents says the weekly off **can't be accumulated**. The user's rule (12 days →
  off + compensatory off) does carry offs over. **The user's rule is followed**, with a setting for how many offs may
  be carried before it turns red (section 4.3).
- **Compensation leave (CH)** for holidays worked stays as built (G.O.(Ms) 43/2021/H&FWD: 3 months, 10 held, a
  yearly limit by post).
- The **6-6-12 shift system** (government hospitals, now extended to private ones) is about shift hours, not offs.
  It doesn't change this plan.

### How rota apps handle it
Nurse rostering apps (RosterLab, RosterElf, QMed and others; Australian state rostering guidelines):
- **Fatigue rules are checked before the roster is published, as warnings** (too many shifts in a row, too few rest
  days), not as hard stops: the manager decides.
- **Consecutive days are the key number** shown per person ("6 in a row"), with a cap that needs days off after it.
- **Offs are planned ahead** on a roster, then confirmed. Offs together are preferred unless the person asks
  otherwise.
- **Off balances are kept fair across the team**: a count per person kept within bounds, not an exact day.
- Marking is **by exception**: everyone is on the roster, and only changes (leave, swaps, absences) are entered.

What this means for WorkDesk: show **"days since the last off"** big and coloured for each person, **plan offs
ahead**, **warn but allow**, and **assume duty unless told otherwise**.

## 3. What is wrong today (checked on the running app, 2026-11-02)

1. **The page opens on a 31-column register.** The thing that matters (who needs an off) is tiny grey text under a
   name ("1 off due · 0 in a row") or "+1 / Off 1" squeezed into the CL / CH cell. Nobody can see at a glance who
   needs an off this week.
2. **Every working day must be ticked for everyone**, or the count stops: an unmarked day counts nothing. One missed
   day of marking and every reminder is wrong. This is the biggest burden.
3. **Off is refused until earned** (greyed out in the bar, left out by the server). Real offices give an off a day
   early. The user then can't record what actually happened.
4. **Starting figures are hidden** in Settings › Attendance, one person at a time, with five fields
   (as on, CL taken, offs due, days towards, holidays with CH). Few will fill them, so the counts start wrong.
5. **No way to fix a count** except finding and changing old marks.
6. **Nothing looks ahead.** No "Mary's off is due on Thursday", no planned offs, no reminder on Home or in the
   morning notification about offs.
7. **Phones**: the day view's rows look greyed out as if disabled, figures are a run-on line ("CL 2 of 20 · CH 0 of
   22, 1 to take · 1 off due · 0 days in a row"), and the separate `/markattendance` page is unlinked and only does
   CL / CH / Off.
8. **Words**: "towards", "run", "counted days", "offs due" are the app's words, not the office's.

## 4. The new design

### 4.1 One number per person: "Day N"

For each weekly-off person the app shows **"Day 5"**: the days of duty since their last off (CL, CH and holidays not
worked count, as now). The colour tells the story:

| Day | Shown | Meaning |
|---|---|---|
| 1–4 | grey "Day 3" | fine |
| 5 | blue "Off due tomorrow" | plan it |
| 6 | amber "Off due today" | the 7th day should be the off |
| 7–11 | orange "Off overdue · Day 8" | still OK by the user's rule, but remind |
| 12+ | red "Day 13 · off + compensatory off due" | the 12-day limit is passed |

Behind it is the same counting as now (6 days earn an off and carry over), so **7 days then an off leaves 1 day
counted, and the next off is due after 5 more**. The words show it: "Day 1 of the next 6 (1 carried over)".

Offs owed beyond the current one show as **"+1 off owed"** (from 12 days without a break, starting figures or
corrections).

### 4.2 Duty is assumed (marking by exception) — (changes committed: unmarked days count nothing)

A new setting, **"Count days not marked as duty"** (Settings › Attendance, on to start, recommended):
- A working day with no mark counts as duty for the weekly-off count. A past unmarked day shows a faint ✓ in the
  register, and a solid ✓ when ticked.
- So the office marks **only the exceptions**: offs, CL, CH, leave and absences. Leave from the Leave page already
  fills itself in.
- **Today and future days are never assumed.** Day N counts up to yesterday, plus today once it is marked or the day
  is over.
- Turned off, the app works as now (every day ticked). "Attendance not marked today" on Home is shown only while
  this is off.

### 4.3 Warn, never block — (changes committed: "an off only once earned", 2026-10-31)

- **Off can always be marked.** Taken early, it is recorded and the person shows **"1 off taken early"**: the count
  continues and the next earned off pays it back. The bar says it in one line ("Mary: off 2 days early, the next one
  is due in 8 days"). The server stops refusing unearned offs; `mark_attendance` for assistants follows.
- Warnings stay for: past 12 days, **CL + CH + offs together for a week or more** (the G.O. 161/08 rule above),
  CL past 20 a year, and 15 days of absence in a row. All are one line, never a block.
- **"Offs owed" turns red past a setting** ("Offs may be carried": 2 to start, 0–5).

### 4.4 Fix the count in one tap

The person sheet (4.6) has **Correct the count**: "Days since last off" and "Offs owed", each with − / +, and an
optional note ("swapped with Priya"). It is saved as a **correction line dated today** (like a leave account's
adjustment line; History "Attendance: Mary's count set to Day 3, 1 off owed"), so the past marks stay as they are
and the figures move from today. Corrections are listed in the sheet and can be undone.

### 4.5 Starting the register: one screen for everyone

A **"Start the register"** page (from a banner on the Attendance page while anyone has no starting point, and from
Settings › Attendance):
- **Start date** (today to start).
- A table of **everyone in the office**, one row each, all editable in place:
  - weekly-off staff: **Last off on** (a date, the easiest thing to remember; the app works out Day N), or "Days
    worked since the last off" instead; **Offs owed** (0);
  - everyone: **CL taken this year** (0) and **Holidays worked, CH still to take** (a chip list, optional).
- **Save all** in one go (one History entry). A row left alone means 0 / start fresh.
- The CSV import (kind `attendance`) stays for big offices, with the new **Last off on** column.

The existing Starting figures card in Settings stays for editing one person, and reads and writes the same data.

### 4.6 The page: three tabs — (changes committed: the page opens on the register)

`/attendance` gets page tabs (`Segmented` / page `Tabs`), remembered per device:

1. **Offs** (opens first): the reminder board.
   - The month's toolbar is replaced by a header: "Weekly off" and **Mark off**.
   - **A card per weekly-off person**, the most urgent first: name and designation, the **Day N pill** (4.1), a strip
     of the **last 14 days** as small squares (duty ✓, off O, CL, CH, leave, holiday; today outlined), "Last off
     Tue 27 Oct", and **planned off** if one is set (4.7). Buttons: **Off today**, **Plan off**, and the card opens
     the person sheet.
   - Above the cards, one line: "**2 need an off today**, 1 is past 12 days" (the same words go to Home).
   - Sunday-off staff are left out here (their Sundays are offs), behind a "Show everyone" switch.
2. **Today**: everyone in the office today, **duty assumed** (4.2), with their state as a chip. Tap a person to
   choose **Off / CL / ½CL / CH / Absent / Duty** in a small menu (an action sheet on phones), saved at once with
   Undo. "Mark everyone present" stays for offices that tick every day (setting off). ‹ › moves the day. This
   replaces the phones' day view and makes `/markattendance` unnecessary for daily use (it stays for long CL / CH
   runs, now linked from the person sheet as "Mark a run of days").
3. **Register**: the month grid as it is now (print, download, summary, the selection bar), for the record.

**Person sheet** (a bottom sheet on phones, a side panel on computers; opened from any name): Day N with its words,
the 14-day strip, the next planned off, offs owed / taken early, CL and CH in plain words ("CL 3 of 20 this year",
"CH: 1 to take by 15 Jan (Onam)"), then actions: **Off today**, **Plan off**, **CL / CH / Absent for a day or
run**, **Correct the count**, **Open their month**.

### 4.7 Plan offs ahead

- **Plan off** picks a date (suggested: the day the off falls due, then the day after; days where too many of the
  same designation are already off are greyed out, "2 Staff Nurses already off").
- A planned off shows as a dotted O on the strip and the register, and in Day N ("Off planned Thu 5 Nov").
- On the day it **becomes an off by itself** unless changed (with "assume duty" on). Moving it is a drag on the strip
  (computers) or Change in the sheet.
- Planned offs aren't counted until the day comes, so a cancelled plan changes nothing.

### 4.8 Reminders outside the page

- **Home › Due Today › Today**: one line, "**Offs due: Mary, Rajesh** · Priya past 12 days" (to the Offs tab), in
  place of "Attendance not marked today" when duty is assumed.
- **Morning notification** (Settings › Notifications summary): "Off due today: Mary, Rajesh".
- **Employee page**: the attendance line starts with Day N.
- **Assistants**: `get_attendance` answers Day N, offs owed and planned offs; a new staff action `plan_off`.

### 4.9 Words

| Now | New |
|---|---|
| days towards the next off / run | **Day N** (days since the last off) |
| offs due | **offs owed** / "Off due today" |
| counted day | (not shown; the help line says CL, CH and holidays count as duty) |
| Off (refused, greyed out) | Off (always), "taken early" |
| Starting figures | **Start the register** / starting point |

## 5. Data

- `attendance_settings`: `assumeDuty` (true), `maxOwed` (2).
- `StartFigures` gets `lastOff` (a date; works out `towards` from the days since then). Old figures keep working.
- New `attendance_adjustments` (employee, date, `setDay` or `addDays`, `addOffs`, note, created) for corrections,
  read by `weeklyFigures` as a fresh starting point on that date. In the backup.
- `attendance_marks.mark` gets `off_planned` (or a `planned` flag on `off`): shown dotted, turned into `off` on the
  day by `maintain`, and counted only from then.
- `weeklyOff`: an unmarked past working day is `count` when `assumeDuty` is on; `offsEarned` refusals become
  warnings (`early`).
- `CACHE_VERSION` bump; tests in `tests/attendance.test.ts` (Day N, 7 + off → 5, 12 → 2 owed, early off, corrections,
  assumed duty, planned offs, the week-of-leave rule).

## 6. Questions (recommended answer first)

1. **Assume duty on unmarked days** for the weekly-off count (4.2)? *Yes*; only exceptions are marked.
2. **Allow early offs** with a warning, and drop the "only once earned" rule from 2026-10-31 (4.3)? *Yes.*
3. **After 12 days**, is the "compensatory off" simply a second off owed (as counted now), not a CH? *Yes, a second
   off.*
4. **Offs carried**: how many before it turns red? *2.*
5. **Starting point**: ask for the **last off date** per person (4.5)? *Yes*, with a days count as the alternative.
6. **Page opens on the Offs board**, with Today and Register as tabs (4.6)? *Yes.*
7. **Planned offs** turn into offs by themselves on the day? *Yes.*
8. **G.O. 161/08 rule** (no weekly off when CL + CH + off run a week or more) as a warning only? *Yes.*
9. **Sunday-off staff who work a Sunday**: today that earns nothing (answer of 2026-10-31). Should it give them an off
   on another day? *No, unchanged*; only weekly-off staff take offs on any day, Sundays included.

## 7. Phases

1. **Offs board and flexible rules**: Day N, the Offs tab (cards, 14-day strip), the person sheet, early offs
   allowed with warnings, Correct the count, the Home line and the morning notification. About one session.
2. **Assumed duty, the Today tab and starting the register**: the setting, the Today tab replacing the phones' day
   view, the Start the register page with Last off on, the CSV column. About one session.
3. **Planned offs and polish**: Plan off, dotted offs, turning into offs on the day, clash hints by designation,
   assistants (`plan_off`), the words in 4.9 everywhere, phones checked at 375px with long Malayalam names. About
   half a session.

## Sources

- AHD Manual, Kerala (G.O.(Ms) 161/08/AD): https://web.cdit.org/animalhusbandry/wp-content/uploads/2022/09/AHD_MANUAL_-_Black__White_-_Final.pdf
- Copy of the weekly-off order (Scribd): https://www.scribd.com/document/282969349/Weekly-Off
- Residents' weekly off (DME Kerala): https://www.dme.kerala.gov.in/pdf/gov_orders/G(MS)20.pdf
- 6-6-12 shift system: https://www.newkerala.com/news/o/uniform-shift-system-across-private-hospitals-kerala-293
- Rostering fatigue rules: https://www.rosterelf.com/uk/blog/rostering-nsw-healthcares-key-success
- Nursing rostering guidelines (WA, 2022): https://westerly.wh.org.au/nursing-midwifery/wp-content/uploads/2022/07/Nursing-Midwifery-Interim-Rostering-Guidelines-2022.pdf
