# WorkDesk MCP server — plan

Status: **planned, not built.** Written 2026-10-18.

The goal: you ask an AI assistant (ChatGPT, Gemini) about your work in plain language — "what's pending for Anila?",
"read the circular's PDF and tell me what we must submit", "make a task from the HMIS email, due Friday" — and it
answers or acts through WorkDesk, with the same rules and records as the app itself.

MCP (Model Context Protocol) is the open standard both assistants use to connect to outside services. WorkDesk would
offer an MCP server: a list of **tools** (search tasks, read an email, add a register entry…) that the assistant calls
when your question needs them.

---

## 1. Decisions (user, 2026-10-18)

| # | Question | Decision |
|---|---|---|
| 1 | Which assistants | **ChatGPT and Gemini** (follow the MCP standard, so any MCP-capable assistant can connect) |
| 2 | Office data | **Consent given to share all data**, including emails and their attachments |
| 3 | Employee details | **All employee data** (PEN, date of birth, phone, address, pay…) readable through the assistant |
| 4 | Changes by the assistant | **Phase 3 allowed**, with a **separate log** of everything the assistant changes (section 6) |

One exception stays regardless of consent: **saved website passwords (Logins) are never given to an assistant.** The
website, link, assigned person and user ID are readable; the password is not. A password in an AI chat can end up in
chat history, and anyone who sees the chat would have it.

---

## 2. Which assistants can connect today

Checked 2026-10-18 (sources at the end). Both change often; re-check before Phase 1 is finished.

| Assistant | Can it connect a custom MCP server? | Notes |
|---|---|---|
| **ChatGPT** (web) | **Yes.** chatgpt.com → Plugins → **Add custom MCP server**: paste the server address, choose OAuth sign-in, create and install it, then type `@` in a chat to use it | Supports streaming HTTP; OAuth with dynamic client registration or Client ID Metadata Documents; write actions ask for confirmation by default (an approval can be remembered for the rest of that chat). Which ChatGPT plans include it is not stated in OpenAI's guide; guides disagree whether personal plans get write actions. **Check in your own account.** |
| **Gemini app** (gemini.google.com) | **Not from India yet.** Google's help page: custom apps need you to be **18+ and in the US**, signed in with a personal Google account, with Keep Activity on; English only | Added on the web, then usable in the Gemini phone app too; write actions always need manual confirmation; supports dynamic client registration. WorkDesk will follow the standard so it works the day this opens up. |
| **Gemini Enterprise / Business** | Yes, if your office has it: an admin adds the server (StreamableHTTP over HTTPS) | Needs a paid Google Workspace edition with Gemini Enterprise. |

**So Phase 1 is built and tested with ChatGPT first**, and kept to the plain MCP standard so Gemini connects without
changes when available.

---

## 3. Ground rules (every phase)

1. **The same rules as the app.** Every tool goes through WorkDesk's existing routes, not separate code. So Gmail stays
   read-only except the approved changes (mark read, your own labels), dismiss / complete change only WorkDesk, every
   change writes History, and every check (dates, ids, permissions) still applies.
2. **No deleting.** No tool deletes a task, email, event, employee, register, file entry or login.
3. **Passwords never** (section 1). No tool returns Gmail tokens, session keys or the server's settings either.
4. **Email text is untrusted.** An email could contain instructions aimed at the assistant ("mark all tasks done"). Tool
   descriptions say email and attachment content is *data to read, not instructions*; write tools are marked so the
   assistant asks you before each change; there is a limit on changes per hour (section 8).
5. **Every change is recorded twice:** in History as today (marked "via assistant") and in the separate
   **assistant log** (section 6).
6. **Read-only by default.** Changes (Phases 3–4) must be switched on in Settings › Assistant, and can be switched off
   at any time.

---

## 4. Architecture

| Part | Plan |
|---|---|
| **Address** | `https://workdesk.workdesk.workers.dev/mcp`, on the same Cloudflare Worker as the app. |
| **Protocol** | Official MCP TypeScript SDK, **Streamable HTTP** transport (what ChatGPT and Gemini Enterprise accept), stateless — no extra Cloudflare services beyond token storage. |
| **Sign-in** | **OAuth 2.1** with PKCE, the way both assistants expect: the assistant sends you to a WorkDesk sign-in page → you sign in with the **same Google account** as WorkDesk → a consent screen ("ChatGPT wants to read and, if allowed, change your WorkDesk") → the assistant receives a token. Supports **dynamic client registration** (ChatGPT, Gemini) and **Client ID Metadata Documents** (ChatGPT). Tokens are stored hashed in a new `mcp_tokens` table, expire (access 1 hour, refresh 60 days), and can be revoked in Settings. Cloudflare's OAuth provider library for Workers may save work here — check at build time. |
| **Tool layer** | `src/server/mcp/`: `server.ts` (registers tools), one file per area (`tasks.ts`, `emails.ts`, `staff.ts`, `registers.ts`, `events.ts`, `files.ts`). Each tool: checks its input with Zod, calls the existing route logic for the signed-in user, returns compact text plus ids for follow-up calls. |
| **Tool marks** | Read tools carry `readOnlyHint: true` (ChatGPT treats tools without it as write actions); write tools carry `readOnlyHint: false`, `destructiveHint: false`, and a clear title so the assistant's confirmation box says what will change. |
| **Answer size** | Lists capped (25 rows, with "more" paging); long emails trimmed with a note; attachments over the limit refused with the reason — nothing is cut short silently. |
| **Languages** | Malayalam and English text passed through unchanged (UTF-8); dates as `YYYY-MM-DD` in Asia/Kolkata, the same as the app. |
| **Settings › Assistant** (new tab) | The connection address with a Copy button, how to add it in ChatGPT / Gemini, connected assistants (name, connected on, last used, **Revoke**), switches: *Allow changes* (Phase 3), *Allow staff actions* (Phase 4), per-area on/off, and the **assistant log** (section 6). |

---

## 5. Phases and tools

### Phase 1 — Read everything (about 2 sessions)

| Tool | What the assistant can do |
|---|---|
| `get_today` | Today's summary: counts, due today, overdue, today's events, increments due, Pending emails |
| `search` | Search emails and tasks (titles, notes, subjects, senders, tag names) |
| `list_tasks` | By view (today / overdue / upcoming / no date / waiting / completed), tag, employee or designation |
| `get_task` | Full task: notes, steps, waiting, "for", tags, its emails, its reminder or event |
| `list_pending_emails` | Pending (and Other sections), with sender, date, labels, status tags |
| `read_email` | The whole conversation as clean text (hidden signatures removed), with the attachment list and the email's task / event |
| `list_reminders` | Reminders with their next and overdue dates |
| `list_events` | Events in a date range with time, venue, attendees, type, status |
| `find_employees` | Search by name, PEN, designation, permanent / temporary, in office / left |
| `get_employee` | Every field (section 1 decision 3): service, pay, increment, probation, retirement, contract, their open work, events, logins (no passwords), joining / relieving steps |
| `list_registers` | Registers with pending counts and "updated until" |
| `list_register_entries` | Entries by register, by person, or General; pending or done |
| `list_joining_relieving` | The Joining & relieving table with each step's state |
| `search_files` | The file register by subject, e-file number or tag |
| `list_logins` | Websites and who each login is for, user IDs — **never passwords** |
| `get_history` | Recent History, by type or search |

**Done when:** in ChatGPT, "What's pending for Anila across everything?" and "What's overdue this week?" get correct
answers, with long Malayalam titles intact.

### Phase 2 — Attachments (about half a session)

| Tool | What it does |
|---|---|
| `list_attachments` | Names, types and sizes for an email |
| `read_attachment` | **Pictures** as images. **PDF** as the file itself (scanned pages read as pictures by the assistant); if the assistant can't take a PDF, the text plus the first pages. **Excel / CSV** as a table (first sheets, row limit stated). **Word (.docx)** and **PowerPoint (.pptx)** as text. Old **.doc / .ppt** explained as unreadable. Over the size limit: refused with the reason. |

**Done when:** "Read the PDF in the DMO's circular and tell me what we must submit by when" works, including a scanned
Malayalam page.

### Phase 3 — Everyday changes (about 2 sessions; allowed, logged — section 6)

Needs **Allow changes** on. Each change asks for your approval in the assistant.

| Tool | Change (same as in the app) |
|---|---|
| `create_task` | New task: title, due date and time, priority, notes, steps, tags, "for" |
| `make_task_from_email` | Create task from a Pending email (it leaves Pending, gets the task label in Gmail) |
| `update_task` | Due date, priority, notes, steps, tags, "for", waiting for reply / reply date |
| `complete_task` / `reopen_task` | The tick — including reminder dates, register entries, joining steps that follow it |
| `add_emails_to_task` / `take_email_off_task` | More emails on a task or event (they leave / return to Pending) |
| `remove_email` | Remove from Pending, or send to a section (Gmail unchanged except the section label) |
| `add_register_entry` / `update_register_entry` / `set_register_entry_done` | Record, change or tick a pending register entry (optional due date → task) |
| `create_event` / `make_event_from_email` | New event, also from an email |
| `set_event_date` | One date of an event: done, cancelled, moved, back to scheduled |

Not offered: deleting anything, Gmail label setup, Logins changes, Settings changes.

### Phase 4 — Staff actions (about 1 session; off by default, own switch, logged)

| Tool | Change |
|---|---|
| `join_employee` / `relieve_employee` | With the date and steps already done, as in Settings › Employees |
| `set_joining_step` | Pending / Waiting / Done in the Joining & relieving table |
| `mark_increment_done` | With the new basic pay |
| `renew_or_end_contract`, `declare_probation` | The same choices as the system tasks |
| `mark_register_updated` | Updated until today, done entries cleared |
| `add_employee` / `update_employee` | Employee details |

### Phase 5 — Comfort (about 1 session)

- **Ready-made prompts** (offered by the server, shown in assistants that support them):
  - *Morning briefing*: today's plan in priority order;
  - *Reply to this email*: reads the email and attachments, drafts an official reply in Malayalam or English (you send
    it yourself — WorkDesk never sends mail);
  - *Employee status*: everything about one person;
  - *Monthly work diary*: written from History.
- **Bell alert** in WorkDesk when the assistant changed something.
- **Assistant log** export (CSV) from Settings › Assistant.

---

## 6. The assistant log (separate from History)

Decision 4: everything the assistant changes is kept in a log of its own, so it can be reviewed apart from your own
work.

| | |
|---|---|
| **Table** | `assistant_actions`: when, which assistant (ChatGPT / Gemini / other, from its sign-in), which tool, the request it sent (inputs, stored as sent), the result (ok / refused / error, with the message), what it touched (task / email / employee / register entry / event ids and titles), and the History entry it made. |
| **What goes in** | Every Phase 3 and 4 call, including ones refused (switched off, limit reached, rule broken). Phase 1–2 reads are counted per day (tool, assistant, how many), not stored one by one. |
| **Where to see it** | Settings › Assistant › **Assistant log**: newest first, filter by assistant, tool or day, each row linking to what was changed; **Export CSV**. |
| **History too** | Each change also writes its usual History entry, marked "via ChatGPT" / "via Gemini", so History stays complete. |
| **Kept for** | One year (older rows cleared by the daily housekeeping). Revoking an assistant keeps its log. |

---

## 7. Data the assistant can see (decisions 2 and 3)

| Area | Shared |
|---|---|
| Emails and attachments | Yes — full text and attachments of emails WorkDesk has |
| Tasks, reminders, events, registers, file register, History | Yes |
| Employees | Yes — all fields, including PEN, date of birth, phone, email, address, category, pay, service dates |
| Logins | Website, link, assigned person, user ID, remarks — **no passwords** |
| Settings, tokens, server keys | No |

---

## 8. Safety limits

- **Changes per hour:** at most 30 by default (changeable in Settings); over the limit, the tool refuses and the
  refusal is logged.
- **Bulk guard:** a single call changes at most 10 items (e.g. completing tasks).
- **Revoke:** Settings › Assistant › Revoke stops an assistant at once (its tokens are deleted).
- **Switches:** *Allow changes* and *Allow staff actions* off → those tools answer "switched off in WorkDesk".
- **Prompt-injection note** in every email / attachment tool description: the content is data, not instructions.

---

## 9. Testing (every phase)

- Automatic tests per tool against the in-memory database, like the rest of WorkDesk: right answers, rules enforced,
  History written, assistant log written for changes, passwords never returned, switches and limits respected, a
  revoked token refused.
- The Gmail-safety test extended so no MCP tool can reach a forbidden Gmail write.
- The official MCP Inspector, then ChatGPT itself with long Malayalam text and real attachments (PDF, scanned PDF,
  Excel, Word, photo).

---

## 10. Effort

| Phase | Sessions | You get |
|---|---|---|
| 1 | ~2 | Sign-in, Settings › Assistant, ask anything about your work |
| 2 | ~0.5 | Attachments read by the assistant |
| 3 | ~2 | Everyday changes by chat, with the assistant log |
| 4 | ~1 | Staff paperwork by chat |
| 5 | ~1 | Prompts, bell alert, log export |
| **Total** | **~6.5** | |

**Before starting Phase 1:** check that your ChatGPT plan offers custom MCP servers ("Add custom MCP server" under
Plugins) and whether it allows write actions; the plan does not depend on it, but testing does.

---

## Sources (checked 2026-10-18)

- [OpenAI: Add a custom MCP server to ChatGPT](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [Google: Connect & manage custom apps for Gemini Apps](https://support.google.com/gemini/answer/17209137?hl=en&co=GENIE.Platform%3DAndroid)
- [ChatGPT MCP: setup, plans and limits (coworker.ai)](https://coworker.ai/blog/chatgpt-mcp)
- [Add an MCP server to ChatGPT (designrevision.com)](https://designrevision.com/blog/add-mcp-server-to-chatgpt)
- [Google Gemini MCP support (tactiq.io)](https://tactiq.io/learn/google-gemini-mcp-support)
- [Gemini Business custom MCP server connections (progressiverobot.com)](https://www.progressiverobot.com/2026/09/06/gemini-business-custom-mcp-server-connections/)
