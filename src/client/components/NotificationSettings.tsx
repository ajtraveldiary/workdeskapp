// Settings > Notifications (user request 2026-10-07): turn phone notifications on for this device, and choose
// what is sent to every device: the morning summary (at a chosen time) and a note at a task's or reminder's
// due time. On iPhone it only works in WorkDesk opened from the Home Screen icon (iOS 16.4 or newer).
import { BellRing, Check, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { pushApi, usePushSettings, useSavePushSettings } from "../api";
import { pushState, thisDeviceEndpoint, turnOffPush, turnOnPush, type PushState } from "../push";
import { Button, Card, ErrorNote, Spinner, cx, inputClass } from "./ui";

export function NotificationSettings() {
  const settings = usePushSettings();
  const save = useSavePushSettings();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [tested, setTested] = useState<string | null>(null);
  useEffect(() => {
    void pushState().then(setState);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setTested(null);
    try {
      await fn();
    } catch (e) {
      setError(new Error(`That didn't work (${e instanceof Error ? e.message : String(e)}). Check the internet connection and try again.`));
    } finally {
      setBusy(false);
      void settings.refetch();
    }
  };
  const on = () => run(async () => setState(await turnOnPush(settings.data!.publicKey)));
  const off = () => run(async () => {
    await turnOffPush();
    setState("off");
  });
  const test = () => run(async () => {
    const { sent } = await pushApi.test(await thisDeviceEndpoint());
    setTested(sent ? "Sent. It should arrive in a few seconds." : "Couldn't send it. Turn notifications off and on again.");
  });
  const d = settings.data;
  const change = (patch: Partial<Pick<NonNullable<typeof d>, "summaryOn" | "summaryTime" | "dueOn">>) =>
    d && save.mutate({ summaryOn: d.summaryOn, summaryTime: d.summaryTime, dueOn: d.dueOn, ...patch });

  return (
    <Card className="p-5">
      <h2 id="notifications" className="flex scroll-mt-24 items-center gap-2 font-semibold text-slate-900">
        <BellRing size={18} className="text-brand-700" /> Notifications
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        A note on your phone each morning with the day's work, and when a task or reminder with a time is due. The app icon shows how many are due
        today and overdue.
      </p>

      <div className="mt-3">
        {state === null || settings.isLoading ? (
          <Spinner size={20} />
        ) : state === "needs-home-screen" ? (
          <Note>
            On iPhone, notifications work in the WorkDesk app on your Home Screen. In Safari tap <b>Share</b> → <b>Add to Home Screen</b>, open WorkDesk from
            the new icon, then come back here. (Needs iOS 16.4 or newer.)
          </Note>
        ) : state === "unsupported" ? (
          <Note>This browser can't show WorkDesk notifications. On iPhone, use the WorkDesk app on your Home Screen.</Note>
        ) : state === "denied" ? (
          <Note>
            Notifications are blocked for WorkDesk. Allow them in iPhone <b>Settings</b> → <b>Notifications</b> → <b>WorkDesk</b>, then come back here.
          </Note>
        ) : state === "off" ? (
          <Button variant="primary" onClick={on} disabled={busy || !d}>
            {busy ? <Spinner size={16} className="text-white" /> : <BellRing size={16} />} Turn on notifications
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto inline-flex items-center gap-1.5 text-sm font-medium text-low-ink">
              <Check size={16} /> On for this device
            </span>
            <Button size="sm" onClick={test} disabled={busy}>
              Send a test
            </Button>
            <Button size="sm" variant="ghost" onClick={off} disabled={busy}>
              Turn off
            </Button>
          </div>
        )}
        {tested && <p className="mt-2 text-footnote text-slate-600">{tested}</p>}
        <div className="mt-2">
          <ErrorNote error={error} />
        </div>
      </div>

      {d && (
        <fieldset className="mt-3 border-t border-line pt-3">
          <legend className="mb-1 text-footnote text-slate-500">
            What to send{d.devices > 0 ? ` (to ${d.devices === 1 ? "1 device" : `${d.devices} devices`})` : ""}
          </legend>
          <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 hover:bg-slate-50">
              <input type="checkbox" className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5" checked={d.summaryOn} onChange={(e) => change({ summaryOn: e.target.checked })} />
              <span className="text-sm text-ink">Morning summary at</span>
            </label>
            <input
              type="time"
              aria-label="Morning summary time"
              className={cx(inputClass, "w-36!")}
              value={d.summaryTime}
              disabled={!d.summaryOn}
              onChange={(e) => e.target.value && change({ summaryTime: e.target.value })}
            />
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 hover:bg-slate-50">
            <input type="checkbox" className="size-4 shrink-0 accent-brand-700 pointer-coarse:size-5" checked={d.dueOn} onChange={(e) => change({ dueOn: e.target.checked })} />
            <span className="text-sm text-ink">At the due time of tasks and reminders that have a time</span>
          </label>
          <p className="mt-1 text-footnote text-slate-500">They arrive within about 10 minutes of the time. Tasks with only a date are in the morning summary.</p>
          <ErrorNote error={save.error} />
        </fieldset>
      )}
    </Card>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-footnote text-slate-600">
      <Info size={16} className="mt-px shrink-0 text-brand-700" />
      <span>{children}</span>
    </p>
  );
}
