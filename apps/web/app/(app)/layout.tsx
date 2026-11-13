import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireCtx } from "@/lib/ctx";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireCtx();
  return <AppShell>{children}</AppShell>;
}
