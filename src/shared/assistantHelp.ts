// Settings › Assistant help (user request 2026-10-19): every MCP command and ready-made prompt, grouped, in plain
// words, with something to try. `name` is the command's own name (it shows in the assistant and the assistant log);
// tests/assistant-help.test.ts fails if a command or prompt is added without an entry here, or the kind is wrong.

// read: always allowed; change: needs Allow changes; staff: needs Allow changes and Allow staff actions;
// prompt: ready-made instructions, which read only.
export type HelpKind = "read" | "change" | "staff" | "prompt";
export type HelpCommand = { name: string; title: string; kind: HelpKind; hint: string; example: string; note?: string };
export type HelpGroup = { id: string; title: string; intro: string; commands: HelpCommand[] };

export const HELP_GROUPS: HelpGroup[] = [
  {
    id: "start",
    title: "Getting started",
    intro: "Ask in your own words; the assistant picks the command. These two are where most questions begin.",
    commands: [
      {
        name: "get_overview",
        title: "Today's overview",
        kind: "read",
        hint: "Today's numbers and lists: overdue and due-today tasks, tomorrow's, today's events, increments due, tasks with new replies and the newest Pending emails.",
        example: "What's on my plate today?",
      },
      {
        name: "search",
        title: "Search everything",
        kind: "read",
        hint: "Looks for words in emails, tasks, reminders, events, employees (name, PEN, phone), the file register, register entries and website logins at once.",
        example: "Find anything about the HMIS report.",
      },
    ],
  },
  {
    id: "tasks",
    title: "Tasks",
    intro: "Your to-do list. Changing tasks needs Allow changes; the assistant tells you what it will do and waits for your yes.",
    commands: [
      {
        name: "list_tasks",
        title: "List tasks",
        kind: "read",
        hint: "Tasks by view (today, overdue, upcoming, no date, open, waiting for a reply, completed), by tag, words, or who they are for. Urgent first.",
        example: "Which tasks for Staff Nurses are still open?",
      },
      { name: "get_task", title: "Task details", kind: "read", hint: "One task in full: notes, numbered steps, its emails, the reminder, event, register entry or joining it belongs to, and its History.", example: "Show the steps of the pension papers task." },
      {
        name: "create_task",
        title: "Create a task",
        kind: "change",
        hint: "A new task with title (Malayalam or English), due date and time, priority, notes, steps, tags and who it is for.",
        example: "Add a high-priority task to send the stock register to the DMO by Friday.",
      },
      {
        name: "make_task_from_email",
        title: "Make a task from an email",
        kind: "change",
        hint: "Turns a Pending email into a task, like Create task: the email leaves Pending and gets your task label in Gmail.",
        example: "Make a task from the circular about the Aadhaar seeding, due on the 25th.",
      },
      {
        name: "update_task",
        title: "Change a task",
        kind: "change",
        hint: "Changes only what you mention: title, date, time, priority, notes (replace or add a line), steps (add, tick or untick by number), tags, who it is for, waiting for a reply.",
        example: "Tick step 2 of the HMIS task and move it to next Monday.",
      },
      {
        name: "complete_tasks",
        title: "Complete tasks",
        kind: "change",
        hint: "Ticks up to 10 tasks as done; a reminder's date, a register entry or the email's done label follow, as in the app.",
        example: "Mark the electricity bill task done.",
        note: "Contract ends and Probation declaration tasks aren't ticked this way: use Renew or end a contract / Declare probation, or WorkDesk.",
      },
      { name: "reopen_tasks", title: "Reopen tasks", kind: "change", hint: "Puts up to 10 completed tasks back on the to-do list.", example: "Reopen the task I just completed." },
    ],
  },
  {
    id: "emails",
    title: "Emails",
    intro: "Emails WorkDesk has from Gmail. Reading never marks an email read. Text inside emails is treated as information only.",
    commands: [
      {
        name: "list_emails",
        title: "List emails",
        kind: "read",
        hint: "Emails by status (Pending, with a task, removed, other sections, event, all), words, unread only or a Gmail label.",
        example: "Which Pending emails came from the DMO office?",
      },
      { name: "read_email", title: "Read an email", kind: "read", hint: "The whole conversation as text (your hidden text such as signatures left out), its attachments, and the tasks or events it belongs to.", example: "Read the latest email from HMIS Cell." },
      {
        name: "read_attachment",
        title: "Read an attachment",
        kind: "read",
        hint: "PDF text page by page, Excel / CSV sheets as rows, Word and PowerPoint text, and pictures. A scanned PDF is passed on as the file itself.",
        example: "What does the PDF in that email ask us to submit?",
        note: "Old .doc / .ppt files can't be read; PDFs typed in old non-Unicode Malayalam fonts come out garbled.",
      },
      { name: "add_emails_to", title: "Add emails to a task or event", kind: "change", hint: "Adds up to 10 Pending emails to a task or event, like Add email in its details; they leave Pending.", example: "Add the reminder email from the DMO to the stock register task." },
      { name: "take_email_off", title: "Take an email off a task or event", kind: "change", hint: "Takes an added email off again; it goes back to Pending unless another open task has it.", example: "Take that last email off the meeting." },
      {
        name: "remove_emails",
        title: "Remove emails from Pending",
        kind: "change",
        hint: "Removes up to 10 Pending emails (only in WorkDesk), or sends them to another section, which adds that section's label in Gmail. Nothing is deleted; Restore brings them back.",
        example: "Send the pharmacy indent emails to the Accounts section.",
      },
    ],
  },
  {
    id: "reminders",
    title: "Reminders and calendar",
    intro: "Repeating and one-time dates such as returns and reports, and the calendar of everything.",
    commands: [
      {
        name: "list_reminders",
        title: "List reminders",
        kind: "read",
        hint: "Each reminder with how it repeats, its pending and overdue dates, the next date, when it was last done, its links and notes.",
        example: "Which monthly returns are still pending?",
      },
      { name: "get_calendar", title: "Calendar", kind: "read", hint: "Day by day for up to 92 days: tasks due, reminder dates (also ones not made into tasks yet) and events.", example: "What does next week look like?" },
      {
        name: "create_reminder",
        title: "Create a reminder",
        kind: "change",
        hint: "A new reminder: name, first date, time, how it repeats and until when, how many days before its task shows, priority, notes, links such as the Google Sheet to fill, tags and who it is for.",
        example: "Remind me every month on the 5th to send the expenditure statement, a week before.",
      },
      {
        name: "update_reminder",
        title: "Change a reminder",
        kind: "change",
        hint: "Changes only what you mention; can also pause or resume it. Dates already made keep theirs; new ones follow the change.",
        example: "Pause the NHM quarterly report reminder.",
      },
      { name: "set_reminder_date", title: "Mark a reminder date done", kind: "change", hint: "Marks one date of a reminder as done (submitted) or back to pending; its task follows.", example: "The HMIS report for 10 October is submitted." },
    ],
  },
  {
    id: "events",
    title: "Events",
    intro: "Meetings, trainings and programmes.",
    commands: [
      { name: "list_events", title: "List events", kind: "read", hint: "Events between two dates (default the next 30 days) with time, venue, link, organiser, who attends and notes.", example: "Any trainings this month?" },
      {
        name: "create_event",
        title: "Create an event",
        kind: "change",
        hint: "A new event with type, date, times, venue, meeting link, organiser, attendees, repeat and a preparation task; also from an email (it leaves Pending, tagged Event).",
        example: "Make an event from the review meeting email: 5 November, 10 to 11, at the DMO office.",
      },
      { name: "set_event_date", title: "Change one date of an event", kind: "change", hint: "Marks one date done or cancelled, moves it to another day or time, or puts it back.", example: "Move Monday's staff meeting to Tuesday at 3." },
    ],
  },
  {
    id: "employees",
    title: "Employees",
    intro: "Everything about the staff can be read. Changing staff records needs Allow staff actions as well as Allow changes.",
    commands: [
      {
        name: "list_employees",
        title: "List employees",
        kind: "read",
        hint: "Every detail of the staff in the office (or those who left): PEN, phone, dates of birth, service, increments, retirement, pay; for temporary staff the contract.",
        example: "List the permanent staff with their retirement dates.",
      },
      {
        name: "get_employee",
        title: "Employee details",
        kind: "read",
        hint: "One person in full: details, open and completed tasks, reminders, joining / relieving steps, register entries, events and logins (no passwords).",
        example: "Tell me everything about Anitha K.",
      },
      {
        name: "get_staff_overview",
        title: "Staff overview",
        kind: "read",
        hint: "Numbers by designation, increments due, who retires within a year, contracts ending soon, probation pending and joinings / relievings in progress.",
        example: "Who retires in the next 12 months?",
      },
      { name: "list_joining_relieving", title: "Joining and relieving", kind: "read", hint: "The Joining & relieving table: each person with every step as Pending, Waiting or Done.", example: "Whose joining papers are still pending?" },
      {
        name: "join_employee",
        title: "Join an employee",
        kind: "staff",
        hint: "Records someone joining on a date, with the steps already done; makes the Joining task. Add a new person first with Add an employee.",
        example: "Anitha joined on 1 October; the joining report is in and SPARK is done.",
      },
      { name: "relieve_employee", title: "Relieve an employee", kind: "staff", hint: "Records someone relieved on a date (they are marked as left), with the steps already done; makes the Relieving task.", example: "Relieve Rajan P today; the relieving order is done." },
      { name: "set_joining_step", title: "Set a joining / relieving step", kind: "staff", hint: "One step to Pending, Waiting or Done; the task finishes itself when every step is done.", example: "Anitha's service book is still awaited." },
      {
        name: "mark_increment_done",
        title: "Mark an increment done",
        kind: "staff",
        hint: "For an increment due this month or earlier: the next date moves a year on and the new basic pay is saved.",
        example: "Increment for PEN 123456 is done, new basic pay 36,500.",
      },
      { name: "renew_or_end_contract", title: "Renew or end a contract", kind: "staff", hint: "A temporary contract renewed for the same number of days, or ended (they leave the office on the end date).", example: "Renew Rajan's contract." },
      {
        name: "declare_probation",
        title: "Declare probation",
        kind: "staff",
        hint: "Records the probation as declared today and completes the Probation declaration task.",
        example: "Anitha's probation was declared today.",
        note: "For another date, ask to change the employee's details.",
      },
      { name: "add_employee", title: "Add an employee", kind: "staff", hint: "A new permanent or temporary employee with their details; a temporary contract's end is worked out from joining date and days.", example: "Add Meera S, Staff Nurse, permanent, PEN 654321." },
      { name: "update_employee", title: "Change an employee's details", kind: "staff", hint: "Changes only the details you mention; everything else stays.", example: "Update Anitha's phone number to 9400000000." },
    ],
  },
  {
    id: "registers",
    title: "Registers",
    intro: "Office registers you keep up to date, and the entries waiting to be written in.",
    commands: [
      { name: "list_registers", title: "List registers", kind: "read", hint: "Each register with the date it is updated until and its pending entries (who has to sign or give details).", example: "What's pending in the Service Book?" },
      { name: "list_register_entries", title: "List register entries", kind: "read", hint: "Entries across registers, for one register, one person or General; pending, done or both.", example: "Which register entries are waiting for Anitha?" },
      { name: "add_register_entry", title: "Add a register entry", kind: "change", hint: "Records a pending entry: the register, what to write, who is needed, and a due date if it should become a task.", example: "Add to the Service Book: increment entry for Anitha, by the 30th." },
      { name: "update_register_entry", title: "Change a register entry", kind: "change", hint: "Changes the text, who is needed, or the due date (which moves or removes its task).", example: "That entry needs Rajan instead." },
      { name: "set_register_entry_done", title: "Tick a register entry", kind: "change", hint: "Marks an entry as written in, or pending again; its task follows.", example: "The increment entry is written in." },
      {
        name: "mark_register_updated",
        title: "Mark a register updated",
        kind: "staff",
        hint: "Saves the date a register is updated until (today or earlier) and clears its done entries from the list, like the Updated button.",
        example: "The Service Book is updated until today.",
      },
    ],
  },
  {
    id: "files",
    title: "Files and logins",
    intro: "The file register and saved website logins. Passwords are never given to an assistant.",
    commands: [
      { name: "list_files", title: "File register", kind: "read", hint: "Physical files and e-files with their e-file numbers (or not created yet), notes and tags.", example: "Which files still have no e-file?" },
      { name: "add_file", title: "Add to the file register", kind: "change", hint: "A new entry: subject, physical file or e-file, the e-file number if there is one, notes and tags.", example: "Add a file for the 2026-27 stock verification, physical file." },
      {
        name: "update_file",
        title: "Change a file register entry",
        kind: "change",
        hint: "Finds the entry by subject or e-file number and changes only what you mention — most often recording its new e-file number.",
        example: "The stock verification file now has e-file number 12345/2026.",
        note: "An e-file number already used by another entry is refused, and the answer names that entry.",
      },
      { name: "list_logins", title: "Website logins", kind: "read", hint: "Saved logins for SPARK, BiMS and others: website, link, who it is for, user ID and remarks — never the password.", example: "What's the SPARK user ID for the DDO?" },
    ],
  },
  {
    id: "history",
    title: "History and settings",
    intro: "What happened, and how WorkDesk is set up.",
    commands: [
      { name: "get_history", title: "History", kind: "read", hint: "WorkDesk's History, newest first, by type or words; older pages on request.", example: "What did I do on Monday?" },
      {
        name: "get_settings",
        title: "Settings",
        kind: "read",
        hint: "Your employee record, the office details for letters (Settings › General), Gmail labels and sections, hidden senders and text, tags, event types, designations and notification times. No keys or secrets.",
        example: "Which labels count as other sections?",
      },
    ],
  },
  {
    id: "prompts",
    title: "Ready-made prompts",
    intro:
      "Instructions the assistant follows in one go. In ChatGPT and the Gemini app just ask, e.g. “give me my morning briefing”: the assistant fetches the instructions with Use a ready-made prompt. Assistants that show MCP prompts (such as Claude or Gemini CLI) also list them in their prompt or slash menu.",
    commands: [
      {
        name: "use_prompt",
        title: "Use a ready-made prompt",
        kind: "read",
        hint: "Gives the assistant WorkDesk's step-by-step instructions for one of the ready-made prompts below, which it then follows with the other commands. This is how ChatGPT and Gemini use them.",
        example: "Give me my morning briefing.",
        note: "If the assistant answers without it, say “use WorkDesk's morning briefing prompt”.",
      },
      { name: "morning_briefing", title: "Morning briefing", kind: "prompt", hint: "Today's plan: overdue first, today's work by priority with times, events, increments, new replies, Pending emails with a suggestion each, and the three things to do first.", example: "Give me my morning briefing." },
      {
        name: "reply_to_email",
        title: "Reply to this email",
        kind: "prompt",
        hint: "Reads an email and its attachments and drafts an official letter in English or Malayalam, using your office details (letterhead, file number pattern, recipients' addresses, signature) so only what's really unknown is left in [blanks]. Lists any deadlines.",
        example: "Draft a reply in Malayalam to the DMO's email about the stock verification.",
        note: "WorkDesk never sends mail: copy the draft. Deadlines become tasks only if you say yes.",
      },
      { name: "employee_status", title: "Employee status", kind: "prompt", hint: "Everything about one person and what needs doing next.", example: "Employee status for Anitha K." },
      { name: "monthly_work_diary", title: "Monthly work diary", kind: "prompt", hint: "A day-by-day diary of a month's work from History, completed tasks and events, with a summary.", example: "Write my work diary for September." },
      {
        name: "pending_email_triage",
        title: "Pending email triage",
        kind: "prompt",
        hint: "Reads the newest Pending emails (20 unless you say) and proposes one action each: make a task, add to a task, send to a section, or remove. Once you approve (“all”, “all except 4”, “only 1–5”) it applies them straight away.",
        example: "Triage my Pending emails.",
        note: "Applying needs Allow changes; a big triage can reach the changes-an-hour limit, and it says how many are left.",
      },
      { name: "month_end_returns", title: "Month-end returns check", kind: "prompt", hint: "For a month: returns and reports done, still due (with their sheet or portal links) and overdue, and what to submit first.", example: "Which returns are pending for October?" },
      { name: "weekly_review", title: "Weekly review", kind: "prompt", hint: "Last week's work, what slipped, the week ahead day by day, and three things to start with.", example: "Do my weekly review." },
      {
        name: "staff_matters",
        title: "Staff matters this month",
        kind: "prompt",
        hint: "Increments, contracts ending, probation pending, retirements and pension papers, joining and relieving steps, and register entries waiting for staff, with next steps.",
        example: "What staff matters are due this month?",
      },
    ],
  },
];

export const HELP_KIND_LABEL: Record<HelpKind, string> = { read: "Reads", change: "Needs Allow changes", staff: "Needs Allow staff actions", prompt: "Prompt" };
