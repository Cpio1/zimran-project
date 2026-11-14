"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Bell, CalendarDays } from "lucide-react";
import { api, listAll } from "@/api/client";
import type { Reminder } from "@/api/types";
import { ReminderModal, offsetLabel } from "@/components/Reminders";
import { Badge, Card, EmptyState, ErrorBox, ListSkeleton, PageHeader, Select } from "@/components/ui";
import { addDaysISO, formatDate, formatDateTime, todayISO } from "@/lib/format";
import { qk, useAllEntries, useProfile } from "@/lib/hooks";

export default function CalendarPage() {
  const profile = useProfile();
  const [range, setRange] = useState<"week" | "month">("week");
  const [tab, setTab] = useState<"agenda" | "notifications">("agenda");
  const [entryFilter, setEntryFilter] = useState("");
  const [edit, setEdit] = useState<Reminder | null>(null);
  const from = todayISO(profile.data?.timezone);
  const to = addDaysISO(from, range === "week" ? 6 : 30);
  const reminders = useQuery({ queryKey: qk.reminders({ from, to }), queryFn: () => listAll((cursor) => api.listReminders({ from_date: from, to_date: to, cursor, limit: 100 })) });
  const benefits = useQuery({ queryKey: qk.benefits({ all: true }), queryFn: () => listAll((cursor) => api.listBenefits({ cursor, limit: 100 })) });
  const cases = useQuery({ queryKey: qk.cases({ known: true }), queryFn: () => listAll((cursor) => api.listCases({ cursor, limit: 100 })) });
  const entries = useAllEntries();
  const notifications = useQuery({ queryKey: qk.notifications, queryFn: () => listAll((cursor) => api.listNotifications({ cursor, limit: 100 })), enabled: tab === "notifications" });

  const entryOf = useMemo(() => {
    const b = new Map((benefits.data ?? []).map((x) => [x.id, x.entry_id]));
    const c = new Map((cases.data ?? []).map((x) => [x.id, x.entry_ids]));
    return (r: Reminder) => (r.benefit_id ? [b.get(r.benefit_id)].filter(Boolean) as string[] : r.case_id ? c.get(r.case_id) ?? [] : []);
  }, [benefits.data, cases.data]);

  const groups = useMemo(() => {
    const list = (reminders.data ?? []).filter((r) => r.status !== "cancelled" && (!entryFilter || entryOf(r).includes(entryFilter)));
    const m = new Map<string, Reminder[]>();
    for (const r of list) m.set(r.date, [...(m.get(r.date) ?? []), r]);
    return [...m.entries()];
  }, [reminders.data, entryFilter, entryOf]);

  return (
    <>
      <PageHeader title="Calendar" subtitle={`Dates from your documents and your reminders · ${profile.data?.timezone ?? ""}`} actions={<Link href="/settings" className="text-sm text-brand-700 hover:underline">Notification settings</Link>} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div role="tablist" aria-label="View" className="flex gap-1 rounded-lg bg-subtle-strong p-1">
          {(["agenda", "notifications"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={clsx("rounded-md px-3 py-1.5 text-sm", tab === t ? "bg-surface font-medium shadow-sm" : "text-muted")}>{t === "agenda" ? "Agenda" : "Notifications"}</button>
          ))}
        </div>
        {tab === "agenda" && (
          <>
            <div role="tablist" aria-label="Range" className="flex gap-1 rounded-lg bg-subtle-strong p-1">
              {(["week", "month"] as const).map((r) => (
                <button key={r} role="tab" aria-selected={range === r} type="button" onClick={() => setRange(r)} className={clsx("rounded-md px-3 py-1.5 text-sm", range === r ? "bg-surface font-medium shadow-sm" : "text-muted")}>{r === "week" ? "This week" : "Next 30 days"}</button>
              ))}
            </div>
            <Select aria-label="Filter by entry" value={entryFilter} onChange={(e) => setEntryFilter(e.target.value)} className="sm:ml-auto sm:w-56">
              <option value="">All entries</option>
              {entries.data?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </Select>
          </>
        )}
      </div>

      {tab === "agenda" ? (
        <>
          {reminders.error && <ErrorBox error={reminders.error} onRetry={() => reminders.refetch()} />}
          {reminders.isLoading && <ListSkeleton rows={3} />}
          {reminders.data && !groups.length && <EmptyState icon={<CalendarDays className="size-8" aria-hidden />} title={`Nothing between ${formatDate(from)} and ${formatDate(to)}`} body="Dates appear here when documents mention them or when you add a reminder to a benefit or case." />}
          <div className="flex flex-col gap-4">
            {groups.map(([date, rs]) => (
              <section key={date} aria-label={formatDate(date) ?? date}>
                <h2 className="mb-2 text-sm font-semibold">{formatDate(date, { weekday: "long", month: "long", day: "numeric" })}{date === from && <span className="ml-2 text-brand-700">Today</span>}</h2>
                <ul className="flex flex-col gap-2">
                  {rs.map((r) => (
                    <Card as="li" key={r.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{r.title}</p>
                        <p className="text-xs text-muted">{r.local_time} {r.timezone.replace(/_/g, " ")} · {r.offset_days.map(offsetLabel).join(", ") || "no alerts"}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {r.status === "needs_review" && <Badge tone="warn">Date to confirm</Badge>}
                        {r.status === "done" && <Badge>Done</Badge>}
                        <Badge>{r.origin === "document" ? "From document" : r.origin === "user" ? "Yours" : "Suggested"}</Badge>
                        {r.benefit_id && <Link href={`/benefits/${r.benefit_id}`} className="text-sm text-brand-700 hover:underline">Benefit</Link>}
                        {r.case_id && <Link href={`/cases/${r.case_id}`} className="text-sm text-brand-700 hover:underline">Case</Link>}
                        <button type="button" onClick={() => setEdit(r)} className="rounded-md px-2 py-1 text-sm hover:bg-subtle-strong">Edit</button>
                      </div>
                    </Card>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      ) : (
        <>
          {notifications.error && <ErrorBox error={notifications.error} onRetry={() => notifications.refetch()} />}
          {notifications.isLoading && <ListSkeleton rows={2} />}
          {notifications.data?.length === 0 && <EmptyState icon={<Bell className="size-8" aria-hidden />} title="No notifications" />}
          <ul className="flex flex-col gap-2">
            {notifications.data?.map((n) => (
              <Card as="li" key={n.id} className="flex items-start gap-3 p-3">
                <Bell className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-sm text-muted">{n.body}</p>
                  <p className="text-xs text-muted">{n.status === "sent" ? `Delivered ${formatDateTime(n.sent_at)}` : n.status === "pending" ? `Scheduled ${formatDateTime(n.scheduled_at)}` : n.status === "failed" ? "Not delivered" : "Cancelled"} · {n.channel === "email" ? "Email" : "In app"}</p>
                </div>
              </Card>
            ))}
          </ul>
        </>
      )}
      {edit && <ReminderModal open onClose={() => setEdit(null)} reminder={edit} />}
    </>
  );
}
