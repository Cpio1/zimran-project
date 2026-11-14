"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/api/client";
import type { EvidenceRef, Profile, Reminder, ReminderOffset } from "@/api/types";
import { REMINDER_OFFSETS } from "@/api/types";
import { invalidate, useProfile } from "@/lib/hooks";
import { Button, ErrorBox, Field, Input, Modal, Notice, Select } from "./ui";

export function timeZones(current?: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  if (!all.length) all = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "UTC"];
  return current && !all.includes(current) ? [current, ...all] : all;
}

export const offsetLabel = (o: ReminderOffset) => (o === 0 ? "On the day" : `${o} day${o === 1 ? "" : "s"} before`);

export function OffsetPicker({ value, onChange, legend = "Remind me" }: { value: ReminderOffset[]; onChange: (v: ReminderOffset[]) => void; legend?: string }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      {/* 32 px chips with 44 px targets (.hit-y); 12 px between wrapped lines so targets don't overlap. */}
      <div className="flex flex-wrap gap-x-1.5 gap-y-3 [@media(pointer:coarse)]:gap-x-2">
        {REMINDER_OFFSETS.map((o) => {
          const on = value.includes(o);
          return (
            <button key={o} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o].sort((a, b) => b - a))}
              className={clsx("hit-y h-8 min-w-11 rounded-full px-3 text-xs font-medium transition-colors [@media(pointer:coarse)]:h-11", on ? "bg-accent text-on-accent" : "bg-subtle-strong text-muted hover:text-ink")}>
              {offsetLabel(o)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function emailAvailable(p: Profile | undefined) {
  return !!p?.email_configured && !!p.email_notification_opt_in && !!p.notification_email;
}

export function ChannelPicker({ value, onChange, profile }: { value: Reminder["channels"]; onChange: (v: Reminder["channels"]) => void; profile: Profile | undefined }) {
  const canEmail = emailAvailable(profile);
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">Where</legend>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked disabled /> In the app</label>
      <label className={clsx("flex items-center gap-2 text-sm", !canEmail && "text-muted")}>
        <input type="checkbox" disabled={!canEmail} checked={value.includes("email")} onChange={(e) => onChange(e.target.checked ? ["in_app", "email"] : ["in_app"])} />
        Email
      </label>
      {!profile?.email_configured && <p className="text-xs text-muted">Email delivery isn&apos;t set up on this server, so reminders appear in the app only.</p>}
      {profile?.email_configured && !canEmail && <p className="text-xs text-muted">To use email, add an address and opt in under Settings.</p>}
    </fieldset>
  );
}

/** Create (no reminder) or edit (reminder given). */
export function ReminderModal({ open, onClose, reminder, create }: {
  open: boolean;
  onClose: () => void;
  reminder?: Reminder;
  create?: { title: string; date: string | null; benefit_id: string | null; case_id: string | null; origin: Reminder["origin"]; evidence_refs: EvidenceRef[] };
}) {
  const qc = useQueryClient();
  const profile = useProfile();
  const p = profile.data;
  const [form, setForm] = useState(() => ({
    date: reminder?.date ?? create?.date ?? "",
    local_time: reminder?.local_time ?? p?.local_notification_time ?? "09:00",
    timezone: reminder?.timezone ?? p?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    offset_days: reminder?.offset_days ?? p?.reminder_offsets ?? ([7, 1, 0] as ReminderOffset[]),
    channels: reminder?.channels ?? (["in_app"] as Reminder["channels"]),
    title: reminder?.title ?? create?.title ?? "",
  }));
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const m = useMutation({
    mutationFn: async (extra: Partial<Pick<Reminder, "status">> = {}) => {
      if (reminder) {
        return api.patchReminder(reminder.id, { date: form.date, local_time: form.local_time, timezone: form.timezone, offset_days: form.offset_days, channels: form.channels, ...extra });
      }
      return api.createReminder({
        benefit_id: create!.benefit_id, case_id: create!.case_id, title: form.title.trim(), date: form.date, timezone: form.timezone,
        local_time: form.local_time, origin: create!.origin, offset_days: form.offset_days, channels: form.channels, status: "active", evidence_refs: create!.evidence_refs,
      });
    },
    onSuccess: () => {
      invalidate(qc, "reminders", "notifications", "dashboard");
      onClose();
    },
  });
  const valid = form.date && /^([01]\d|2[0-3]):[0-5]\d$/.test(form.local_time) && form.title.trim();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={reminder ? "Edit reminder" : "Add reminder"}
      footer={
        <>
          {reminder && reminder.status !== "cancelled" && <Button variant="subtleDanger" className="sm:mr-auto" loading={m.isPending} onClick={() => m.mutate({ status: "cancelled" })}>Turn off</Button>}
          {reminder && reminder.status === "cancelled" && <Button variant="ghost" className="sm:mr-auto" loading={m.isPending} onClick={() => m.mutate({ status: "active" })}>Turn back on</Button>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} loading={m.isPending} onClick={() => m.mutate(reminder?.status === "needs_review" ? { status: "active" } : {})}>
            {reminder?.status === "needs_review" ? "Confirm and save" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {reminder?.status === "needs_review" && <Notice tone="warn">This date came from a document and hasn&apos;t been confirmed. Check it before saving.</Notice>}
        {!reminder && (
          <Field label="Title" htmlFor="r-title"><Input id="r-title" value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" htmlFor="r-date"><Input id="r-date" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></Field>
          <Field label="Time" htmlFor="r-time"><Input id="r-time" type="time" value={form.local_time} onChange={(e) => set("local_time", e.target.value)} /></Field>
        </div>
        <Field label="Time zone" htmlFor="r-tz">
          <Select id="r-tz" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
            {timeZones(form.timezone).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </Select>
        </Field>
        <OffsetPicker value={form.offset_days} onChange={(v) => set("offset_days", v)} />
        <ChannelPicker value={form.channels} onChange={(v) => set("channels", v)} profile={p} />
        {m.error && <ErrorBox error={m.error} onRetry={() => m.mutate({})} />}
      </div>
    </Modal>
  );
}
