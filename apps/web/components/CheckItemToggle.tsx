'use client';

// Checklist tick: the bound server action is passed as a prop (allowed); the change
// handler lives here in a client component because server components cannot take
// event handlers.
export function CheckItemToggle({
  action,
  done,
  label,
}: {
  action: (formData: FormData) => void;
  done: boolean;
  label: string;
}) {
  return (
    <form action={action}>
      <div className="row">
        <input
          type="checkbox"
          checked={done}
          onChange={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}
          aria-label={label}
        />
        <span style={{ textDecoration: done ? 'line-through' : 'none' }}>{label}</span>
      </div>
    </form>
  );
}
