"use client";

import { Button } from "@ed/ui";

export function ReloadButton({ label }: { label: string }) {
  return (
    <Button variant="primary" onClick={() => window.location.reload()}>
      {label}
    </Button>
  );
}
