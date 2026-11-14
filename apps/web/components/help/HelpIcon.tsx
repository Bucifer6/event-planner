import type { SVGProps } from "react";

/** Question mark in a hairline circle, drawn to the Maison icon rules (24 grid, 1.5 stroke). */
export function HelpIcon({ size = 20, ...rest }: Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden
      focusable="false"
      {...rest}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.75a2.5 2.5 0 1 1 3.75 2.17c-.78.45-1.25.98-1.25 1.83M12 16.75v.25" />
    </svg>
  );
}
