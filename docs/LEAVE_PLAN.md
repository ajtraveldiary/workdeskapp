# Leave of employees — plan

Status: **Phase 1 built** (2026-10-30): gazetted and probation declared switches, gazetted posts, leave types, leave
accounts with opening balances, credits and adjustments by hand, Credit now. Phases 2–4 not built yet. Written 2026-10-30.

The office marks the longer leaves of its permanent staff (earned leave, half pay leave, commuted leave and the like),
keeps each employee's **leave account** (credits, leave taken, balance), credits the yearly leave (such as 20 days of
half pay leave), and follows each leave's paperwork as a task whose steps depend on whether the employee is a
**gazetted** officer. Casual leave, compensation leave and other short office leaves are **not** kept here.

---

## 1. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Which leaves | Every leave except casual leave, compensation leave and similar short leaves (user, 2026-10-30). |
| 2 | Leave account | Kept per employee and leave type, with the balance (user). |
| 3 | Yearly credits | A way to credit leave every year, such as 20 days of half pay leave (user). |
| 4 | Task on marking a leave | Yes, with steps; different steps for gazetted and non-gazetted officers (user). |
| 5 | Gazetted or not | A new field in the employee's details (user). |
| 6 | How earned leave is credited | **Worked out from duty** (1/11 of the days on duty) for employees whose probation is declared (user, 2026-10-30). |
| 7 | Probation declared or not | A missing declared date does **not** mean probation isn't declared (old staff whose date was never entered). So the employee details get a **Probation declared: Yes / No** switch, and that switch decides (user). |
| 8 | When yearly credits are made | **On each employee's service anniversary** (user). |
| 9 | When the leave task is due | **The rejoining day**, the day after the leave ends (user). |
| 10 | Extras built with it | **EOL moves the increment (and probation)**, **surrender of EL**, **gazetted from the designation** (user; 9.1, 9.3, 9.4). The others in section 9 wait. |

## 2. Ground rules

1. **Permanent staff only.** Temporary employees have no leave account and no Mark leave button.
2. **The leave account is never rewritten.** Every change is a new line (credit, leave, adjustment, cancellation), so
   the account reads like the leave account in a service book and every line has a reason. A wrong line is put right
   with an adjustment, never deleted.
3. **Every leave, credit, adjustment and setting change writes History** (`staff.leave_*`), naming the employee.
4. **Nothing in Gmail changes.**
5. **Committed work stays as it is.** Leave is built beside joining / relieving, pension, contract and probation; their
   tasks and screens are not changed.
6. The usual app rules apply: touch first, phones compact, long Malayalam names checked at 375px and on computers, no
   overflow, drag and drop for ordering, `CACHE_VERSION` bumped, docs/FILES.md, README.md and CLAUDE.md updated.

---

## 3. Leave types

Kept per user in a new **Settings › Leave** tab (the `NameList` editor used for designations: add, rename, drag to
arrange, remove only when unused). "Add the usual leaves" adds the Kerala Service Rules leaves the office uses:

| Leave | Short | Has its own account | What one day of it takes from the account |
|---|---|---|---|
| Earned leave | EL | Yes, credited from duty (section 5) | 1 day of EL |
| Half pay leave | HPL | Yes | 1 day of HPL |
| Commuted leave | Commuted | No — draws on HPL | **2 days of HPL** (half pay leave taken at full pay on a medical certificate) |
| Leave not due | LND | No — draws on HPL | 1 day of HPL, which may go below zero; also counted against its own service limit |
| Extraordinary leave | EOL | No | Nothing |
| Maternity leave | ML | No | Nothing |
| Paternity leave | PL | No | Nothing |

Each type has: name, short name, **draws on** (itself, another type or none), **days taken per day** (1, or 2 for
commuted), **may go below zero** (LND), **maximum balance** (e.g. EL 300; credits above it lapse with a "lapsed" line),
**medical certificate needed** (commuted, LND; see 9.2), and its **yearly credit** (section 5). The user can add others
(special disability leave, hospital leave, study leave…) with the same fields. The figures above are the usual rules;
the user checks them once in Settings, where all of them can be changed.

## 4. The leave account

A new table `leave_ledger`: one line per change to one employee's balance of one leave type.

| Field | Meaning |
|---|---|
| `employeeId`, `typeId` | Whose account, which leave |
| `date` | The date the line counts from |
| `days` | + credit, − taken (half days allowed: numeric with one decimal) |
| `kind` | `opening` · `credit` · `leave` · `cancel` · `adjust` · `lapse` · `surrender` (9.4) |
| `leaveId` | The leave this line belongs to, for `leave` / `cancel` |
| `creditFor` | The yearly credit this line is (e.g. "2026"), so a credit is never made twice (unique per employee, type, `creditFor`) |
| `note` | Order number, reason, "Opening balance from service book", … |

**Balance** = the sum of the lines. The employee page shows each type's balance and the lines, newest first.

**Opening balances.** Past accounts are not in WorkDesk, so each employee starts with an *Opening balance as on
<date>* per leave type (from their service book). Entered on the employee page, or for everyone at once with a
"Leave balances" CSV import (columns: PEN or name, leave short name, balance, as on).

## 5. Yearly credits

Each leave type with an account may have a **yearly credit**: *N days* (HPL: 20), made **on each employee's
service anniversary** or **on a fixed date** for everyone (1 January, 1 April or a date chosen), for permanent staff
still in the office. HPL needs a *completed* year: the first credit comes one year after joining service.

- **Automatic:** the background queue's upkeep job (`maintain`) adds the credits that have fallen due since the last
  run, in one bulk insert (the subrequest limit), each with its `creditFor`, so a missed or repeated run never credits
  twice. Credits are only made from the day the rule is switched on, never back-dated over the opening balances.
- **By hand:** "Credit now" on a leave type in Settings (e.g. *Credit 20 days HPL to all permanent staff for 2027*),
  with a preview of who gets it; and "Add credit / adjustment" on one employee's account.
- A credit above the type's maximum balance adds a `lapse` line for the extra.

### Earned leave, from duty (user's choice)

On each service anniversary, an employee **whose probation is declared** (the new switch, section 7) is credited
**1/11 of the days on duty** in the year that has just ended:

- days on duty = the days of that service year (from the opening balance's date when it started later) **less every
  day of leave marked in WorkDesk** in it (all types, EOL included; casual leave isn't kept, so it counts as duty);
- the result is rounded to whole days (half a day or more rounds up; the rounding is a setting) and capped by EL's
  maximum balance (300), the extra lapsing;
- the line's note shows the working, e.g. "365 days, 20 on leave → 345 on duty ÷ 11 = 31 days".

Employees whose probation is not declared get no automatic EL credit (see section 10); their EL is added by hand.

## 6. Marking a leave

**Mark leave** on the employee page, on the Employees page (header button, and the phones' + menu beside Join /
Relieve), and later for assistants. The form (`LeaveDialog`, a sheet on phones):

- Employee (permanent, in the office; grouped by designation), leave type, **from** and **to** dates.
- **Days**, worked out as calendar days from–to inclusive and editable (prefixed / suffixed holidays left out by
  editing the days or the dates), half days allowed.
- Sanction order number and date (optional), reason / notes (optional).
- The account line it will make and the **balance after**, e.g. "HPL 46 → 26 (commuted 10 days takes 20)". A balance
  that would go below zero (other than LND) shows a red warning (question in section 10: allow or refuse).
- Steps already done (tick boxes, as in "Joining procedure for current staff"), for leave being entered late.

Saving makes, in one request:

1. an `employee_leaves` row: employee, type, from, to, days, order no / date, notes, `rejoinedOn` (empty until the
   joining report), `status` (`active` / `cancelled`), `taskId`;
2. the account line(s): `leave`, −days × days-per-day, on the type it draws on;
3. a task **"Leave: <name> — <short> <days> days"** (e.g. "Leave: Priya Nair — HPL 10 days"), For the employee, made
   by the system, `systemKind` **"leave"**, high priority, notes with the dates and order, and the steps below;
4. a History entry.

### Steps

Gazetted officers (the user's list):

1. Leave application received
2. Apply leave
3. Update leave CTC
4. Joining report
5. Joining CTC
6. AG payslip

Non-gazetted officers (the user's list):

1. Application received
2. Check leave account
3. Office proceedings
4. Update in SPARK
5. Mark in attendance
6. SB update
7. Joining report

Kept in `src/shared/leave.ts` with fixed step ids (as `MOVE_STEPS`), so the steps can be **Pending / Waiting / Done**
like joining and relieving (`ChecklistItem.waiting`), and the task **completes itself when every step is done** and
reopens if a step is set back (as `settleMoveTask`). Ticking the task completes it plainly.

### After marking

- **Edit** (dates, days, type, order): the account line is replaced by a `cancel` line for the old one and a new
  `leave` line, so the history shows the change; the task's title, notes and due date follow.
- **Rejoined early (curtailed)** or **extended**: "Rejoined on" on the leave sets the real end; days and the account
  follow with the same cancel + new line. An extension is a new leave marked "extension of" the first (its own task).
- **Cancel the leave**: a `cancel` line gives the days back; the open task is completed with the note "Leave cancelled"
  (kept in History, not deleted).
- **Deleting the task** leaves the leave and its account lines alone.
- The task's "Joining report" step being done asks for the rejoining date (filled with the day after the leave).

## 7. Screens

- **Employee form:** "Probation declared" Yes / No switch (permanent staff only), beside the existing declared date
  (the date stays optional; entering a date turns the switch on). Existing employees with a declared date start as
  Yes, the rest as No. Shown on the employee page's At a glance (probation) and in the Employees CSV ("Probation
  declared": Yes / No).
- **Employee form:** "Gazetted officer" switch (permanent staff only), in Service, filled from the designation's
  "Gazetted post" tick when the designation is chosen (9.1). Shown on the employee card and page
  ("Gazetted" tag), in the Employees table (filter, not a new column, to keep the table as it is), and in the
  Employees CSV ("Gazetted": Yes / No).
- **Employee page:** a **Leave** card: balances per type (EL 120 · HPL 46 · LND used 0 of 360), "On leave till 10 Nov"
  when on leave, Mark leave, Add opening balance / credit / adjustment, the leaves (open / past, each with its task's
  steps chip), and the account lines (15, then Show all).
- **Employees page:** an **On leave** card after Joining & relieving, one line until opened (as the Moves card): who
  is on leave today and who rejoins in the next 7 days; and a small "On leave" tag on their rows.
- **Settings › Leave:** leave types with their rules and yearly credits, "Add the usual leaves", "Credit now".
- **Home:** leave tasks show on Due Today and To-do like other tasks; folded into one line like pension papers
  ("2 leaves: Pending") — see 9.6.
- **Calendar:** leave periods as chips on wider screens / a dot on phones ("Priya Nair on HPL") — see 9.6.

## 8. Server, data, imports

- Migration 0047: `employees.gazetted` (boolean, default false); `employees.probation_declared` (boolean; true where
  `probation_declared_on` is set); `designations.gazetted` (boolean, default false); `leave_types`; `employee_leaves`; `leave_ledger`
  (unique `employeeId, typeId, creditFor`). `Task.systemKind` gains `"leave"`.
- Routes `routes/leave.ts`: `/api/leave-types` (list with use counts, add, add usual, PATCH, order, delete when
  unused, `POST /:id/credit` with `dryRun`), `/api/leaves` (list by employee / on leave on a date, add, PATCH, cancel,
  rejoined), `/api/leave-ledger` (employee's lines and balances, add opening / credit / adjust), `POST /api/leaves/:id/step`
  (as `/moves/:id/step`). `PATCH /tasks/:id` with a checklist settles a leave task as joining's does.
- `lib/leave.ts`: balances, the lines for a leave, `ensureLeaveCredits` (run by `maintain`), `settleLeaveTask`.
- Backup: `leaveTypes`, `employeeLeaves`, `leaveLedger`. CSV kinds: "Leave balances" (import) and "Leave"
  (export: every leave with its dates and days). The service worker's offline copies need no change.
- Tests: `tests/leave.test.ts` (balance maths, commuted takes double, LND below zero, credit once per year and on the
  anniversary, lapse above the maximum, edit / cancel / rejoin lines, gazetted vs non-gazetted steps, task completes
  when all steps are done, History rows, other users' employees refused, temporary staff refused).
- Assistants (a later phase, Allow staff actions): read tool `get_leave_account`; staff tool `mark_leave`; entries in
  `src/shared/assistantHelp.ts` (enforced by `tests/assistant-help.test.ts`).

## 9. More that may be needed (suggestions)

1. **Gazetted from the designation** *(chosen)*. Gazetted status follows the post (Medical Officer, Superintendent…), so a
   "Gazetted post" tick on designations could fill the employee's switch, still changeable per employee.
2. **Medical leave papers.** For leave types marked "medical certificate needed" (commuted, LND), add the steps
   "Medical certificate received" and, before rejoining, "Fitness certificate received".
3. **EOL moves the increment (and probation)** *(chosen)*. Extraordinary leave without a medical certificate does not count for
   increment, and leave generally extends probation; after marking EOL, offer to move the next increment date (and the
   probation due date) by the days taken, as a choice with Undo.
4. **Surrender of earned leave** *(chosen)* (encashment, usually 30 days a year, and at retirement): a "Surrender EL" action that
   adds a `surrender` line and a task with its own steps (application, sanction, bill, update in SPARK, SB update).
5. **Limits warnings:** LND used against its service limit (360 days), EL above its maximum, leave longer than a type
   allows at a time.
6. **Home and Calendar:** leave tasks folded into one line on Home like pension papers; leave periods on the calendar;
   "On leave today" on Home's Today tab.
7. **Charge arrangement** for a gazetted officer on leave: who holds the charge (an employee), shown on the leave and
   in the task's notes.
8. **Leave account print:** an employee's leave account as a printable page / CSV, in the service book's layout.

## 10. Answered when Phase 1 started (the recommendations, user 2026-10-30)

1. **EL for employees whose probation is not declared:** no automatic EL credit; added by hand.
2. **The Probation declared switch and the probation task:** "Yes" stops the automatic Probation declaration task
   (an open one completes) and the employee page shows "Declared (date not entered)" instead of the old guess;
   "Probation declared" in the task's choice turns the switch on and its Undo off. Existing staff were set to yes
   where a declared date was entered or 2 years of service were done more than 2 years ago (as the app already
   assumed); the rest are no until changed.
3. **Not enough balance:** warn and allow (Phase 2).
4. **Surrender of EL steps:** application, sanction order, bill, update in SPARK, SB update (Phase 4).

---

## 11. Phases

1. **Gazetted and probation declared switches** (with gazetted designations), **leave types, leave account**
   (opening balances, credits by hand, balances on the employee page, Settings › Leave). About 1 session.
2. **Marking leave** with the account lines and the task with gazetted / non-gazetted steps; edit, cancel, rejoin;
   the On leave card. About 1 session.
3. **Yearly credits automatically** (HPL 20 days, EL from duty), the balances CSV import, backup, exports. About half a session.
4. **The chosen extras** (EOL moves the increment and probation, surrender of EL) and assistants. About 1 session.
