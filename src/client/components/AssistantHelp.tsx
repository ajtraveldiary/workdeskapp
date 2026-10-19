// Settings › Assistant help (user request 2026-10-19): every command ChatGPT or Gemini can use in WorkDesk, grouped,
// with what it does, something to try (copyable) and whether it only reads or needs Allow changes / Allow staff
// actions (shown with the switches' current state). The text lives in src/shared/assistantHelp.ts.
import { useState } from "react";
import { Check, Copy, Info, Search } from "lucide-react";
import { HELP_GROUPS, HELP_KIND_LABEL, type HelpCommand, type HelpKind } from "../../shared/assistantHelp";
import { useAssistant } from "../api";
import { Badge, Card, cx, type Tone } from "./ui";

const KIND_TONE: Record<HelpKind, Tone> = { read: "neutral", change: "brand", staff: "high", prompt: "snooze" };

export function AssistantHelp({ onOpenSettings }: { onOpenSettings: () => void }) {
  const settings = useAssistant().data;
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const groups = HELP_GROUPS.map((g) => ({
    ...g,
    commands: g.commands.filter((c) => !query || [c.title, c.name, c.hint, c.example, c.note ?? "", g.title].some((s) => s.toLowerCase().includes(query))),
  })).filter((g) => g.commands.length);
  const total = HELP_GROUPS.reduce((n, g) => n + g.commands.length, 0);
  const onOff = (on: boolean | undefined) => (on === undefined ? "…" : on ? "On" : "Off");

  return (
    <>
      <Card className="p-5">
        <h2 className="font-semibold text-slate-900">Using the assistant</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Ask in your own words, in English or Malayalam — the assistant picks the command. The names below are for reference: they show in the assistant and in the assistant log.</li>
          <li>Reading is always allowed. Before any change the assistant says what it will do and waits for your yes; nothing can ever be deleted, and website passwords are never shared.</li>
          <li>Things written inside emails and attachments are treated as information, never as orders.</li>
        </ul>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-slate-600">
          <span>
            Allow changes: <span className={cx("font-medium", settings?.allowChanges ? "text-low-ink" : "text-ink")}>{onOff(settings?.allowChanges)}</span>
          </span>
          <span>
            Allow staff actions: <span className={cx("font-medium", settings?.allowChanges && settings.allowStaff ? "text-low-ink" : "text-ink")}>{onOff(settings && settings.allowChanges && settings.allowStaff)}</span>
          </span>
          <button type="button" onClick={onOpenSettings} className="font-medium text-brand-700 hover:underline active:scale-[0.97]">
            Change in Assistant
          </button>
        </p>
      </Card>

      <label className="relative block">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${total} commands`}
          aria-label="Search assistant commands"
          className="h-10 w-full rounded-lg border border-line bg-white pr-3 pl-8 text-sm outline-none hover:border-slate-300 focus:border-brand-500 pointer-coarse:h-9"
        />
      </label>

      {groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">No command matches “{q.trim()}”.</p>
      ) : (
        groups.map((g) => (
          <Card key={g.id} className="overflow-hidden">
            <div className="border-b border-line px-4 py-3 sm:px-5">
              <h2 className="font-semibold text-slate-900">
                {g.title} <span className="text-footnote font-normal text-slate-500">· {g.commands.length}</span>
              </h2>
              <p className="mt-0.5 text-footnote text-slate-600">{g.intro}</p>
            </div>
            <ul className="divide-y divide-line">
              {g.commands.map((c) => (
                <CommandRow key={c.name} c={c} />
              ))}
            </ul>
          </Card>
        ))
      )}
    </>
  );
}

function CommandRow({ c }: { c: HelpCommand }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard?.writeText(c.example).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-ink">{c.title}</span>
        <Badge tone={KIND_TONE[c.kind]}>{HELP_KIND_LABEL[c.kind]}</Badge>
        <code className="text-caption text-slate-500 select-text">{c.name}</code>
      </div>
      <p className="mt-1 text-footnote text-slate-600 [overflow-wrap:anywhere]">{c.hint}</p>
      <div className="mt-1.5 flex items-start gap-2">
        <p className="min-w-0 flex-1 text-footnote text-ink [overflow-wrap:anywhere] select-text">
          <span className="text-slate-500">Try: </span>“{c.example}”
        </p>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy: ${c.example}`}
          title="Copy"
          className="-mt-0.5 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-ink active:scale-90"
        >
          {copied ? <Check size={14} className="text-low-ink" /> : <Copy size={14} />}
        </button>
      </div>
      {c.note && (
        <p className="mt-1 flex items-start gap-1.5 text-footnote text-slate-500">
          <Info size={13} className="mt-0.5 shrink-0" /> {c.note}
        </p>
      )}
    </li>
  );
}
