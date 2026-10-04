import { Card, PageHeader } from "../components/ui";

export function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports & recurring duties" />
      <Card className="p-6">
        <p className="font-medium text-slate-800">Coming in Phase 3</p>
        <p className="mt-1 max-w-prose text-sm text-slate-600">
          Monthly, quarterly and annual reporting obligations, each with its own due-date rule and reminders. WorkDesk will
          create a fresh task for every reporting period and keep a period-by-period record of what was submitted.
        </p>
      </Card>
    </>
  );
}
