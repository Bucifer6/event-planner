"use client";

import { Notice } from "@ed/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { attachQuoteAction } from "@/app/actions/suppliers";
import { FileField } from "@/components/upload/FileField";

/** Uploads a quote (PDF or photo) and attaches it to the booking (P12): the booking becomes "quoted". */
export function QuoteUpload({ occasionId, bookingId, purpose, labels }: { occasionId: string; bookingId: string; purpose: string; labels: { field: string; hint: string; attaching: string; attached: string } }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="ed-form">
      <FileField
        label={labels.field}
        hint={labels.hint}
        purpose={purpose}
        ownerId={occasionId}
        allowPdf
        onUploaded={(file) => {
          setMessage(null);
          startTransition(async () => {
            const res = await attachQuoteAction({ occasionId, bookingId, assetId: file.id });
            setMessage(res.ok ? { ok: true, text: labels.attached } : { ok: false, text: res.error.message });
            router.refresh();
          });
        }}
      />
      {pending ? <p className="ed-small ed-muted" role="status">{labels.attaching}</p> : null}
      {message ? <Notice tone={message.ok ? "success" : "danger"} title={message.text} /> : null}
    </div>
  );
}
