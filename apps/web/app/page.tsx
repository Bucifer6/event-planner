import { redirect } from "next/navigation";
import { actorAccountId } from "@ed/core/context";
import { getCtx } from "@/lib/ctx";

export default async function HomePage() {
  const ctx = await getCtx();
  redirect(actorAccountId(ctx.actor) ? "/occasions" : "/sign-in");
}
