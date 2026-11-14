"use client";

import { Button, FocusFirstError, Notice, Sheet, SubmitButton, TextareaField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { acceptOfferAction, declineOfferAction, withdrawOfferAction } from "@/app/actions/tasks";

/**
 * A4: the person a task was offered to accepts or declines. Declining opens a sheet that asks
 * for a short reason and says where the task goes: back to the person who offered it.
 */
export function OfferActions({
  occasionId,
  delegationId,
  taskTitle,
  fromName,
}: {
  occasionId: string;
  delegationId: string;
  taskTitle: string;
  fromName: string;
}) {
  const t = useTranslations("tasks.offer");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [accepted, accept] = useActionState(acceptOfferAction, null);
  const [declined, decline] = useActionState(declineOfferAction, null);
  useEffect(() => {
    if (declined?.ok) setOpen(false);
  }, [declined]);
  const declineError = declined && !declined.ok ? declined.error : null;

  return (
    <>
      {accepted && !accepted.ok ? <Notice tone="danger">{accepted.error.message}</Notice> : null}
      <div className="ed-cluster">
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          {t("decline")}
        </Button>
        <form action={accept}>
          <input type="hidden" name="occasionId" value={occasionId} />
          <input type="hidden" name="delegationId" value={delegationId} />
          <SubmitButton variant="secondary" className="ed-btn--sm" pendingLabel={t("accepting")}>
            {t("accept")}
          </SubmitButton>
        </form>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("declineTitle")} closeLabel={c("actions.close")}>
        <form action={decline} className="ed-form" noValidate>
          <input type="hidden" name="occasionId" value={occasionId} />
          <input type="hidden" name="delegationId" value={delegationId} />
          <p>{t("declineBody", { title: taskTitle, from: fromName })}</p>
          {declineError && !declineError.fieldErrors?.reason ? <Notice tone="danger">{declineError.message}</Notice> : null}
          <TextareaField
            id={`decline-${delegationId}`}
            name="reason"
            label={t("reasonLabel")}
            hint={t("reasonHint")}
            rows={3}
            maxLength={300}
            required
            defaultValue={declineError?.values?.reason ?? ""}
            error={declineError?.fieldErrors?.reason?.[0]}
          />
          <FocusFirstError errors={declineError?.fieldErrors ?? null} />
          <SubmitButton variant="primary" block pendingLabel={t("declining")}>
            {t("declineSubmit")}
          </SubmitButton>
          <Button type="button" block onClick={() => setOpen(false)}>
            {t("keepThinking")}
          </Button>
        </form>
      </Sheet>
    </>
  );
}

/** The delegator takes an unanswered offer back. */
export function WithdrawOffer({ occasionId, delegationId }: { occasionId: string; delegationId: string }) {
  const t = useTranslations("tasks.offer");
  const [state, withdraw] = useActionState(withdrawOfferAction, null);
  return (
    <form action={withdraw}>
      <input type="hidden" name="occasionId" value={occasionId} />
      <input type="hidden" name="delegationId" value={delegationId} />
      {state && !state.ok ? <Notice tone="danger">{state.error.message}</Notice> : null}
      <SubmitButton variant="secondary" className="ed-btn--sm" pendingLabel={t("withdrawing")}>
        {t("withdraw")}
      </SubmitButton>
    </form>
  );
}
