"use client";

import { Notice, SubmitButton } from "@ed/ui";
import { markStationeryProofedAction, setDigitalInvitationAction } from "@/app/actions/stationery";
import { useForm } from "../../_components/useForm";

/** "Am verificat proba" — the manager's mark that opens the print PDF for this exact version. */
export function MarkProofed({ occasionId, version, label, pendingLabel }: { occasionId: string; version: number; label: string; pendingLabel: string }) {
  const f = useForm(markStationeryProofedAction, { refresh: true });
  return (
    <form action={f.formAction}>
      <input type="hidden" name="occasionId" value={occasionId} />
      <input type="hidden" name="version" value={version} />
      {f.error ? <Notice tone="danger">{f.error.message}</Notice> : null}
      <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
    </form>
  );
}

export function DigitalToggle({ occasionId, enabled, label, pendingLabel }: { occasionId: string; enabled: boolean; label: string; pendingLabel: string }) {
  const f = useForm(setDigitalInvitationAction, { refresh: true });
  return (
    <form action={f.formAction}>
      <input type="hidden" name="occasionId" value={occasionId} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      {f.error ? <Notice tone="danger">{f.error.message}</Notice> : null}
      <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
    </form>
  );
}
