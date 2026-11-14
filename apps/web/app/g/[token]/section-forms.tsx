"use client";

import { ChoiceChips, Meter, Notice, Stepper, SubmitButton } from "@ed/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { setGuestContributionAction } from "@/app/actions/contributions";
import { castPollVotesAction } from "@/app/actions/polls";
import styles from "./guest.module.css";

// Small forms of the guest link's extra sections. Wording arrives through props in the
// link's language. Each form carries the token, the language and the SEC11 bot guard.

export type GuestFormBase = {
  token: string;
  lang: "ro" | "en";
  stamp: string;
  stampField: string;
  honeypotField: string;
  honeypotLabel: string;
};

function Guard({ base }: { base: GuestFormBase }) {
  return (
    <>
      <input type="hidden" name="token" value={base.token} />
      <input type="hidden" name="lang" value={base.lang} />
      <input type="hidden" name={base.stampField} value={base.stamp} />
      <div className="ed-vh" aria-hidden="true">
        <label>
          {base.honeypotLabel}
          <input type="text" name={base.honeypotField} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
    </>
  );
}

function useRefreshOnSuccess(state: { ok: boolean } | null) {
  const router = useRouter();
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
  }, [state, router]);
}

export function PollVoteForm({
  base,
  pollId,
  options,
  labels,
}: {
  base: GuestFormBase;
  pollId: string;
  options: Array<{ id: string; label: string; vote: "yes" | "maybe" | "no" | null }>;
  labels: { yes: string; maybe: string; no: string; send: string; sending: string; saved: string };
}) {
  const [state, formAction] = useActionState(castPollVotesAction, null);
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="ed-form">
      <Guard base={base} />
      <input type="hidden" name="pollId" value={pollId} />
      <div>
        {options.map((o) => (
          <div className={styles.pollRow} key={o.id}>
            <ChoiceChips
              name={`vote_${o.id}`}
              legend={o.label}
              defaultValue={o.vote ?? undefined}
              options={[
                { value: "yes", label: labels.yes },
                { value: "maybe", label: labels.maybe },
                { value: "no", label: labels.no },
              ]}
            />
          </div>
        ))}
      </div>
      {state?.ok ? (
        <Notice tone="success" role="status">
          {labels.saved}
        </Notice>
      ) : null}
      {state && !state.ok ? (
        <Notice tone="danger" role="alert">
          {state.error.message}
        </Notice>
      ) : null}
      <div>
        <SubmitButton variant="secondary" pendingLabel={labels.sending}>
          {labels.send}
        </SubmitButton>
      </div>
    </form>
  );
}

export function ContributionForm({
  base,
  need,
  labels,
}: {
  base: GuestFormBase;
  need: { id: string; title: string; note: string | null; unitsNeeded: number; unitsLeft: number; mine: number };
  labels: {
    meter: string;
    stepper: string;
    decrease: string;
    increase: string;
    save: string;
    saving: string;
    saved: string;
    full: string;
    mine: string;
  };
}) {
  const [state, formAction] = useActionState(setGuestContributionAction, null);
  useRefreshOnSuccess(state);
  const max = need.mine + need.unitsLeft;
  return (
    <form action={formAction} className={styles.need}>
      <Guard base={base} />
      <input type="hidden" name="needId" value={need.id} />
      <div>
        <strong>{need.title}</strong>
        {need.note ? <p className="ed-small ed-muted">{need.note}</p> : null}
      </div>
      <Meter value={need.unitsNeeded - need.unitsLeft} max={need.unitsNeeded} label={labels.meter} />
      {max > 0 ? (
        <div className={styles.needControls}>
          <Stepper
            key={`${need.mine}-${max}`}
            name="units"
            label={labels.stepper}
            defaultValue={need.mine}
            min={0}
            max={max}
            decreaseLabel={labels.decrease}
            increaseLabel={labels.increase}
          />
          <SubmitButton variant="secondary" pendingLabel={labels.saving}>
            {labels.save}
          </SubmitButton>
        </div>
      ) : (
        <p className="ed-small ed-muted">{labels.full}</p>
      )}
      {need.mine > 0 ? <p className="ed-small">{labels.mine}</p> : null}
      {state?.ok ? (
        <Notice tone="success" role="status">
          {labels.saved}
        </Notice>
      ) : null}
      {state && !state.ok ? (
        <Notice tone="danger" role="alert">
          {state.error.message}
        </Notice>
      ) : null}
    </form>
  );
}
