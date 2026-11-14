import { qrCredential } from "@ed/core/qr";
import type { Metadata } from "next";
import GuestLinkPage, { generateMetadata as guestMetadata } from "../../[token]/page";

// The landing of a QR printed on a physical invitation (C-09, SEC2).
//
// /g/q/<qrId> shows the household's OWN invitation view — the very page of its link, drawn by
// the same component with the same guest actor. The qrId travels as a scoped credential
// ("qr-<qrId>") wherever the page would carry the link token (its forms, the language
// switch), and lib/guest.ts resolves both through @ed/core/qr resolveGuestCredential: the same
// "not found" for an unknown, revoked or expired code, the same per-IP limits, never the
// guest list.

type Props = { params: Promise<{ qrId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const asToken = async (params: Props["params"]) => ({ token: qrCredential((await params).qrId) });

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  return guestMetadata({ params: asToken(params), searchParams });
}

export default async function QrLandingPage({ params, searchParams }: Props) {
  return GuestLinkPage({ params: asToken(params), searchParams });
}
