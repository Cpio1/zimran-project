"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { API_BASE_URL, API_MODE } from "@/api/config";
import { readSession, startNewDemo } from "@/api/session";
import type { Profile, ReminderOffset } from "@/api/types";
import { CONTRACT_VERSION } from "@/api/types";
import { OffsetPicker, timeZones } from "@/components/Reminders";
import { useToast } from "@/components/Toast";
import { Badge, Button, Card, ErrorBox, Field, Input, ListSkeleton, Modal, Notice, PageHeader, SectionTitle, Select } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { qk, useProfile } from "@/lib/hooks";

export default function SettingsPage() {
  const profile = useProfile();
  return (
    <>
      <PageHeader title="Settings" subtitle="Notifications and this demo space. No account needed." />
      <div className="grid gap-5 lg:grid-cols-2">
        {profile.error && <ErrorBox error={profile.error} onRetry={() => profile.refetch()} />}
        {profile.isLoading && <ListSkeleton rows={2} />}
        {profile.data && <NotificationSettings p={profile.data} />}
        <div className="flex flex-col gap-5">
          <DemoSpace />
          {API_MODE === "mock" && <MockControls />}
          <About />
        </div>
      </div>
    </>
  );
}

function NotificationSettings({ p }: { p: Profile }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tz, setTz] = useState(p.timezone);
  const [time, setTime] = useState(p.local_notification_time);
  const [offsets, setOffsets] = useState<ReminderOffset[]>(p.reminder_offsets);
  const [email, setEmail] = useState(p.notification_email ?? "");
  const [optIn, setOptIn] = useState(p.email_notification_opt_in);
  const save = useMutation({
    mutationFn: () =>
      api.patchProfile({
        timezone: tz, local_notification_time: time, reminder_offsets: offsets,
        ...(p.email_configured ? { email_notification_opt_in: optIn && !!email.trim(), notification_email: email.trim() || null } : {}),
      }),
    onSuccess: (np) => {
      qc.setQueryData(qk.profile, np);
      toast("Settings saved.");
    },
  });
  const emailInvalid = !!email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <Card className="flex flex-col gap-4 p-4">
      <SectionTitle title="Notifications" />
      <Field label="Time zone" htmlFor="s-tz">
        <Select id="s-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
          {timeZones(tz).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
        </Select>
      </Field>
      <Field label="Default time" htmlFor="s-time"><Input id="s-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-40" /></Field>
      <OffsetPicker value={offsets} onChange={setOffsets} legend="Default reminders" />
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className="text-sm font-medium">Email (optional)</p>
        {!p.email_configured ? (
          <Notice tone="info">Email delivery isn&apos;t set up on this server. Reminders appear in the app — you don&apos;t need an email for anything.</Notice>
        ) : (
          <>
            <Field label="Email for reminders" htmlFor="s-email" hint="Only used for reminders you choose. Leave empty to keep in-app only." error={emailInvalid ? "Enter a valid email address." : null}>
              <Input id="s-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={optIn} disabled={!email.trim()} onChange={(e) => setOptIn(e.target.checked)} />
              I agree to receive reminder emails at this address.
            </label>
          </>
        )}
      </div>
      {save.error && <ErrorBox error={save.error} onRetry={() => save.mutate()} />}
      <Button variant="primary" className="self-start" loading={save.isPending} disabled={emailInvalid || !offsets} onClick={() => save.mutate()}>Save</Button>
    </Card>
  );
}

function DemoSpace() {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expires, setExpires] = useState<string | null>(null);
  useEffect(() => setExpires(readSession()?.expires_at ?? null), []);
  const reset = async () => {
    setBusy(true);
    try {
      await startNewDemo();
      setExpires(readSession()?.expires_at ?? null);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex flex-col gap-3 p-4">
      <SectionTitle title="Demo space" />
      <p className="text-sm text-muted">Your documents and chats are kept for this browser{expires ? ` until ${formatDateTime(expires)}` : ""}. Another browser gets its own separate space.</p>
      <Button className="self-start" onClick={() => setConfirm(true)}>Start new demo</Button>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Start a new demo?" footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" loading={busy} onClick={reset}>Start new demo</Button></>}>
        <p className="text-sm">This browser will switch to a new, empty space. Documents and chats in the current space won&apos;t be shown here anymore.</p>
      </Modal>
    </Card>
  );
}

function MockControls() {
  const [flags, setFlags] = useState<{ ai_off?: boolean }>({});
  useEffect(() => {
    void import("@/mocks/core").then((m) => setFlags(m.getMockFlags()));
  }, []);
  const toggle = async () => {
    const m = await import("@/mocks/core");
    const next = { ...flags, ai_off: !flags.ai_off };
    m.setMockFlags(next);
    setFlags(next);
  };
  const expire = async () => {
    const m = await import("@/mocks/core");
    const s = readSession();
    if (s) m.expireMockSession(s.session_token);
  };
  return (
    <Card className="flex flex-col gap-3 p-4">
      <SectionTitle title="Sample mode controls" action={<Badge tone="warn">Sample mode</Badge>} />
      <p className="text-sm text-muted">Everything runs in this browser with sample data. These switches help check error states.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!flags.ai_off} onChange={toggle} /> Simulate “AI not configured” (503)</label>
      <Button size="sm" className="self-start" onClick={expire}>Expire session on next request (401)</Button>
      <p className="text-xs text-muted">Upload a file whose name contains “unreadable” to see a failed analysis.</p>
    </Card>
  );
}

function About() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm">
      <SectionTitle title="About" />
      <p>Mode: <strong>{API_MODE === "mock" ? "Sample (mock)" : "Live backend"}</strong></p>
      <p className="break-all">Backend: {API_BASE_URL}</p>
      <p>Contract: {CONTRACT_VERSION} {health.data && (health.data.contract_version === CONTRACT_VERSION ? <Badge tone="brand">matches backend</Badge> : <Badge tone="danger">backend {health.data.contract_version}</Badge>)}</p>
      <p>Backend status: {health.isLoading ? "checking…" : health.data ? <Badge tone={health.data.status === "ok" ? "brand" : "warn"}>{health.data.status}</Badge> : <Badge tone="danger">unreachable</Badge>}</p>
    </Card>
  );
}
