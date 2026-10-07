// Sections of the office (user request 2026-10-07). The user's Gmail labels are sections: the task label is
// the user's own pending work and the done label their completed work; every other label marks another
// section, unless it is ticked in Settings > Mail as only for organising mail. An email in Pending with another
// section's label is taken as handled by that section: it moves to "Other sections" (state "elsewhere") and
// never becomes a task or gets the done label. A new reply brings it back to Pending (threadRules); it then
// keeps sectionLabelId, shows "Back from …" and doesn't move away again. Taking the label off (or marking it
// as organising) brings it back too. Changes only WorkDesk; Gmail is never touched here.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../db";
import { emailThreads, events, gmailLabels } from "../db/schema";
import { getTaskLabels } from "./taskLabels";

export async function applySectionRules(db: DB, userId: string, onlyGmailThreadIds?: string[]) {
  if (onlyGmailThreadIds && onlyGmailThreadIds.length === 0) return { moved: 0, back: 0 };
  const s = await getTaskLabels(db, userId);
  const own = new Set([s.taskLabelId, s.doneLabelId].filter((x): x is string => !!x));
  const organise = new Set(s.organizeLabelIds);
  const sectionsOf = (labelIds: string[]) => labelIds.filter((id) => id.startsWith("Label_") && !own.has(id) && !organise.has(id));

  const threads = await db
    .select({ id: emailThreads.id, state: emailThreads.state, labelIds: emailThreads.labelIds, sectionLabelId: emailThreads.sectionLabelId, subject: emailThreads.subject })
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.userId, userId),
        inArray(emailThreads.state, ["needs_decision", "elsewhere"]),
        sql`(cardinality(${emailThreads.labelIds}) > 0 or ${emailThreads.state} = 'elsewhere')`,
        onlyGmailThreadIds ? inArray(emailThreads.gmailThreadId, onlyGmailThreadIds) : undefined,
      ),
    );
  const away: { id: string; label: string; subject: string }[] = [];
  const back: { id: string; subject: string }[] = [];
  const relabel: { id: string; label: string }[] = [];
  for (const t of threads) {
    const sections = sectionsOf(t.labelIds);
    const mine = t.labelIds.some((id) => own.has(id)); // the task label wins: it's the user's own work
    if (t.state === "needs_decision") {
      if (sections.length && !mine && !t.sectionLabelId) away.push({ id: t.id, label: sections[0]!, subject: t.subject });
    } else if (sections.length === 0 || mine) {
      back.push({ id: t.id, subject: t.subject });
    } else if (!sections.includes(t.sectionLabelId ?? "")) {
      relabel.push({ id: t.id, label: sections[0]! });
    }
  }
  if (!away.length && !back.length && !relabel.length) return { moved: 0, back: 0 };

  const names = new Map(
    (await db.select({ id: gmailLabels.gmailLabelId, name: gmailLabels.name }).from(gmailLabels).where(eq(gmailLabels.userId, userId))).map((l) => [l.id, l.name]),
  );
  const now = new Date();
  for (const label of new Set(away.map((a) => a.label))) {
    const ids = away.filter((a) => a.label === label).map((a) => a.id);
    await db.update(emailThreads).set({ state: "elsewhere", sectionLabelId: label, stateChangedAt: now, updatedAt: now }).where(inArray(emailThreads.id, ids));
  }
  if (back.length) {
    await db
      .update(emailThreads)
      .set({ state: "needs_decision", sectionLabelId: null, stateChangedAt: now, updatedAt: now })
      .where(inArray(emailThreads.id, back.map((b) => b.id)));
  }
  for (const r of relabel) await db.update(emailThreads).set({ sectionLabelId: r.label, updatedAt: now }).where(eq(emailThreads.id, r.id));
  const log = [
    ...away.map((a) => ({ userId, entityType: "email" as const, entityId: a.id, action: "email.elsewhere", summary: `Handled by ${names.get(a.label) ?? "another"} section; left Pending`, detail: { subject: a.subject } })),
    ...back.map((b) => ({ userId, entityType: "email" as const, entityId: b.id, action: "email.returned", summary: "No other section's label any more; back to Pending", detail: { subject: b.subject } })),
  ];
  if (log.length) await db.insert(events).values(log);
  return { moved: away.length, back: back.length };
}
