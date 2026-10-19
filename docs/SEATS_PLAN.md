# Additional charge of a seat — plan

Status: **planned, not built.** Written 2026-10-19.

A clerk is sometimes given the **additional charge** of another seat (say B2, besides their own B1) for weeks or
months, by an order. That seat brings its own files, registers, returns, staff matters and emails. WorkDesk should keep
the two seats' work apart, show them together when wanted, and help take over and hand over the charge cleanly.

---

## 1. Decisions (user, 2026-10-19)

| # | Question | Decision |
|---|---|---|
| 1 | How the extra seat's emails arrive | **The same Gmail, a label per seat.** The office Gmail already labels emails by section; while the user holds a seat's charge, that seat's label counts as theirs. |
| 2 | Open work when the charge is handed over | **Choose per item:** *Handed over* (closed with a note, kept in History) or *Keep with me* (moves to the user's own seat). |
| 3 | Switching between seats | **One switch at the top** of every screen: All seats / B1 / B2; lists, Home, counts and the calendar follow it. |

## 2. Ground rules

1. **Nothing changes until a second seat exists.** Without an additional charge there is no seat field, chip or switch;
   everything already in WorkDesk belongs to the user's own seat.
2. **Gmail stays as it is:** read-only except the label changes already allowed; seats only decide how labels are read.
3. **Nothing is deleted** when a charge ends: handed-over items are closed with a note and stay in History.
4. Every seat change (charge taken, ended, an item moved or handed over) writes History.
5. The usual app rules apply: touch first, phones compact, long Malayalam text checked, no overflow.

---

## 3. Phases

### Phase 1 — Seats on everything (about 1 session)

- **Settings › Seats** (a new tab): the user's own seat (name such as "B1", what it covers) and additional charges, each
  with the seat name, its Gmail label (a section label), charge order number and date, from date, until date (optional)
  and notes. Add, edit, end (Phase 3) — never delete one that has work.
- **Seat on records:** tasks, reminders (their tasks follow), events (their preparation tasks follow), register
  entries (their tasks follow), file register entries and website logins get an optional seat; empty = own seat.
- **Forms:** a small "Seat" choice appears only while an additional charge is held. New items start on the seat the
  switch shows, else the user's own.
- **Rows:** a small chip ("B2") on items of an additional seat; the user's own seat shows no chip.
- **The switch:** All seats / B1 / B2 in the top bar (phones: a compact chip beside the title; computers: next to the
  search). Remembered per device. Lists, Home's cards and counts, Due Today, the calendar and the icon badge follow it;
  "All seats" is the default.
- **Imports / backup:** a "Seat" column in the Tasks & reminders and File register CSVs; seats in the backup.

### Phase 2 — Emails of the extra seat (about half a session)

- While a charge is held (from date reached, not ended), its Gmail label is **the user's**: emails with it stay in (or
  return to) **Pending** with the seat chip, instead of going to Other sections; tasks made from them get that seat.
- The task and done labels work as before for both seats.
- When the charge ends, the label is another section again: new emails with it go to Other sections; older ones stay
  where they are.
- The Emails page and Home follow the seat switch (Pending of B2 only, and so on).

### Phase 3 — Taking over and handing over (about 1 session)

- **Taking over:** adding a charge makes a task "Charge taken: B2" (made by the system, for the user) with steps that
  can be Pending / Waiting / Done, like joining: charge order received; charge report signed; files list received;
  registers received; pending works list received; portal logins received.
- **Handing over:** "End charge" first shows the **handover list** of everything open for that seat — tasks and
  reminders with dates, pending register entries, files without an e-file number, coming events — which can be
  printed or shared (PDF / CSV) as the pending-works list for the officer taking over. Then, for each item (or all at
  once): *Handed over* (closed, note "Handed over to <name> on <date>") or *Keep with me* (moved to the user's own
  seat). The charge gets its end date, and a task "Charge handed over: B2" with the mirror steps (charge report,
  files list, registers, pending works list, logins handed over).
- History: charge taken, charge ended, items handed over or kept.

### Phase 4 — Assistants and letters (about half a session)

- Assistants see the seats; list commands take a seat (“what's pending in B2?”); answers show each item's seat;
  change commands can set a seat.
- **Office details per seat:** a seat can have its own file number pattern and a signature line such as
  "Senior Clerk (in additional charge of B2)"; letters drafted for that seat's work use them.
- New ready-made prompts: **Charge handover list** (for a seat, as Phase 3's list, written as a letter enclosure) and
  **Seat status** (everything pending for one seat).
- Assistant help updated.

---

## 4. Effort

About 3 sessions in all (Phase 1 the largest). Each phase is useful on its own and can be committed separately.

## 5. Testing (each phase)

Automatic tests: seats added and ended, records with and without a seat, the switch's filters on lists and counts,
labels as Pending / Other sections across a charge's dates, the handover choices (closed with a note / moved), History
entries, CSV and backup round trips. Then the phone preset (375px) and desktop, with long Malayalam seat names, titles
and notes.
