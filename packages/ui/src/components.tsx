import type { ReactNode } from 'react';

export function Card(props: { children: ReactNode; className?: string }) {
  return (
    <div className={`card${props.className ? ` ${props.className}` : ''}`}>{props.children}</div>
  );
}

export function Notice(props: { children: ReactNode; attention?: boolean }) {
  return <div className={`notice${props.attention ? ' attention' : ''}`}>{props.children}</div>;
}

export function FactualLabel(props: { children: ReactNode }) {
  return <span className="label-factual">{props.children}</span>;
}

export function Unknown() {
  return <span className="unknown">unknown</span>;
}
