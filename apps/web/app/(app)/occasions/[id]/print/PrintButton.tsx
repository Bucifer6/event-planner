"use client";

import { Button } from "@ed/ui";

export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="primary" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
