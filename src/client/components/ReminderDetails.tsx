// Reminder details (user request 2026-10-07): tapping a reminder in All reminders opens this read-only card
// with everything about it, a preview of its linked Google document, and Edit, Pause/Resume, Delete and
// Mark done (for its earliest date not yet done, whose task already exists). Like Task details, a tap outside closes it.
import { Bell, CalendarDays, CalendarCheck, Check, Clock, ExternalLink, Maximize2, Pause, Pencil, Play, Repeat as RepeatIcon, StickyNote, Trash2, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Report } from "../../shared/types";
import { dayLabel, nextOccurrence, remindLabel, repeatText } from "../../shared/reminderSchedule";
import { useDeleteReport, useSetPeriodStatus, useUpdateReport } from "../api";
import { parseDriveUrl, type DriveLink } from "../driveLinks";
import { addDays, formatDateTime, formatDay, formatTime } from "../format";
import { AttachmentViewer, DriveFrame, GoogleButton } from "./EmailViewer";
import { linkKind, linkName } from "./ReminderLinks";
import { RelatedLine } from "./Related";
import { showUndo } from "./SwipeRow";
import { Badge, Button, ErrorNote, Modal, PriorityPill, cx } from "./ui";

// The links Google can show a preview of (Docs, Sheets, Slides, Drive files), named as in the reminder.
const previewOf = (l: Report["links"][number]): DriveLink | null => {
  const d = parseDriveUrl(l.url);
  return d ? { ...d, name: linkName(l) } : null;
};

export function ReminderDetails({ report, today, onClose, onEdit }: { report: Report | null; today: string; onClose: () => void; onEdit: (r: Report) => void }) {
  const canPreview = !!report?.links.some((l) => previewOf(l));
  return (
    <Modal open={report !== null} onClose={onClose} title="Reminder details" closeOnBackdrop wide={canPreview}>
      {report && <Details key={report.id} report={report} today={today} onClose={onClose} onEdit={onEdit} />}
    </Modal>
  );
}

function Details({ report, today, onClose, onEdit }: { report: Report; today: string; onClose: () => void; onEdit: (r: Report) => void }) {
  const update = useUpdateReport();
  const remove = useDeleteReport();
  const setStatus = useSetPeriodStatus();
  // The date due now: the earliest one not yet done (its task already exists).
  const due = [...report.periods].filter((p) => p.status === "pending").sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const lastDone = report.periods.find((p) => p.status !== "pending" && p.submittedAt);
  // The date after the one due now (or the next one, when nothing is due yet).
  const next = report.active ? nextOccurrence(report, due ? addDays(due.dueDate, 1) : today) : null;
  const previews = report.links.map(previewOf);
  const [shown, setShown] = useState(previews.findIndex(Boolean));
  const preview = shown >= 0 ? previews[shown] : null;
  const [viewing, setViewing] = useState(false);
  const busy = update.isPending || remove.isPending || setStatus.isPending;

  const markDone = () =>
    due &&
    setStatus.mutate(
      { id: due.id, submitted: true },
      {
        onSuccess: () => {
          onClose();
          showUndo({ message: `Done: ${dayLabel(due.dueDate)}`, onUndo: () => setStatus.mutate({ id: due.id, submitted: false }) });
        },
      },
    );
  const del = () => {
    if (!confirm(`Delete "${report.name}"? Its open tasks are removed. Completed tasks stay in History.`)) return;
    remove.mutate(report.id, { onSuccess: onClose });
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">{report.name}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <PriorityPill priority={report.priority} />
          {!report.active ? <Badge>Paused</Badge> : due && due.dueDate < today ? <Badge tone="urgent">Overdue</Badge> : <Badge tone="low">Active</Badge>}
        </div>
      </div>

      <dl className="space-y-2.5 text-sm">
        {due && (
          <Row icon={CalendarDays} label={due.dueDate > today ? "Next" : "Due"}>
            <span className={cx(due.dueDate < today && "font-medium text-urgent-ink")}>
              {due.dueDate < today ? `Overdue · was due ${formatDay(due.dueDate, today)}` : formatDay(due.dueDate, today)}
            </span>
          </Row>
        )}
        <Row icon={CalendarDays} label={due ? "After that" : "Next"}>
          {!report.active ? <span className="text-slate-500">Paused</span> : next ? formatDay(next, today) : <span className="text-slate-500">No more dates</span>}
        </Row>
        <Row icon={RepeatIcon} label="Repeats">
          {repeatText(report)}
        </Row>
        {report.dueTime && (
          <Row icon={Clock} label="Time">
            {formatTime(report.dueTime)}
          </Row>
        )}
        <Row icon={Bell} label="Remind me">
          {report.leadDays > 0 ? remindLabel(report.leadDays) : "On the day"}
        </Row>
        {lastDone?.submittedAt && (
          <Row icon={CalendarCheck} label="Last done">
            {dayLabel(lastDone.dueDate)} <span className="text-slate-500">· marked {formatDateTime(lastDone.submittedAt)}</span>
          </Row>
        )}
        {/* What the reminder is about (Staff, user request 2026-10-07); its open tasks follow. */}
        <Row icon={UserRound} label="For">
          <RelatedLine value={report} busy={update.isPending} onChange={(v) => update.mutate({ id: report.id, input: v })} />
        </Row>
        <Row icon={StickyNote} label="Notes">
          {report.notes ? <span className="select-text whitespace-pre-wrap">{report.notes}</span> : <span className="text-slate-500">No notes</span>}
        </Row>
      </dl>

      {report.links.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm text-slate-500">Documents</p>
          {/* A Google file shows its preview below when chosen; other links open outside. */}
          <div className="flex flex-wrap gap-1.5">
            {report.links.map((l, i) => {
              const k = linkKind(l.url);
              const look = "inline-flex max-w-full min-w-0 items-start gap-1 rounded-md border px-1.5 py-0.5 text-left text-footnote active:scale-[0.97]";
              const body = (
                <>
                  <k.icon size={13} className={cx("mt-[3px] shrink-0", k.color)} aria-hidden />
                  <span className="line-clamp-2 [overflow-wrap:anywhere]">{linkName(l)}</span>
                </>
              );
              return previews[i] ? (
                <button
                  type="button"
                  key={`${l.url}-${i}`}
                  onClick={() => setShown(i)}
                  aria-pressed={shown === i}
                  title="Show preview"
                  className={cx(look, "border-line bg-white text-ink hover:bg-slate-50 aria-pressed:border-brand-300 aria-pressed:bg-tint aria-pressed:text-brand-800")}
                >
                  {body}
                </button>
              ) : (
                <a key={`${l.url}-${i}`} href={l.url} target="_blank" rel="noreferrer" title={l.url} className={cx(look, "border-line bg-white text-ink hover:bg-slate-50")}>
                  {body}
                  <ExternalLink size={12} className="mt-[3px] shrink-0 text-slate-400" aria-hidden />
                </a>
              );
            })}
          </div>
          {preview && (
            <div className="mt-2 rounded-lg border border-line">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{preview.name}</span>
                <Button size="sm" onClick={() => setViewing(true)}>
                  <Maximize2 size={14} /> Open
                </Button>
                <GoogleButton link={preview} />
              </div>
              <div className="p-2">
                <DriveFrame key={preview.id} link={preview} className="h-[45vh] max-sm:h-[40vh]" />
              </div>
              <AttachmentViewer open={viewing} onClose={() => setViewing(false)} title={preview.name} actions={<GoogleButton link={preview} />} fill>
                <DriveFrame link={preview} className="h-full" />
              </AttachmentViewer>
            </div>
          )}
        </div>
      )}

      <ErrorNote error={update.error ?? remove.error ?? setStatus.error} />

      {/* One line like Task details: Delete and Edit on the left, Pause/Resume and Mark done on the right. It
          stays pinned to the bottom of the pop-up, so the buttons are in reach while a preview fills the box
          (it takes over the pop-up's own bottom padding, including the phone's home-bar space). */}
      <div className="sticky bottom-0 z-[1] -mb-5 flex flex-wrap items-center gap-2 border-t border-line bg-white pt-4 pb-5 max-sm:-mb-[calc(1.25rem+env(safe-area-inset-bottom))] max-sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-sm:[&>button]:flex-1 max-sm:[&>button]:px-2">
        <Button variant="danger" onClick={del} disabled={busy} aria-label="Delete reminder" title="Delete reminder" className="max-sm:flex-none!">
          <Trash2 size={15} />
        </Button>
        <Button onClick={() => onEdit(report)} className="sm:mr-auto">
          <Pencil size={15} /> Edit
        </Button>
        <Button onClick={() => update.mutate({ id: report.id, input: { active: !report.active } })} disabled={busy}>
          {report.active ? <Pause size={15} /> : <Play size={15} />} {report.active ? "Pause" : "Resume"}
        </Button>
        {due && (
          <Button variant="primary" onClick={markDone} disabled={busy}>
            <Check size={15} /> Mark done
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof CalendarDays; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="flex w-28 shrink-0 items-center gap-1.5 leading-5 whitespace-nowrap text-slate-500">
        <Icon size={15} className="shrink-0" /> {label}
      </dt>
      <dd className="min-w-0 flex-1 leading-5 text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
