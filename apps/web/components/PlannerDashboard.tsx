import type { ReactNode } from 'react';

export type PlannerEvent = { id: string; title: string; date: string; status: string };

type Props = {
  title: string;
  createLabel: string;
  emptyLabel: string;
  events: PlannerEvent[];
  renderLink?: (href: string, className: string, children: ReactNode) => ReactNode;
};

export function PlannerDashboard({ title, createLabel, emptyLabel, events, renderLink }: Props) {
  const Container = renderLink ? 'main' : 'div';
  return (
    <Container className="wrap planner-dashboard">
      <div className="planner-cover">
        <div className="planner-cover-copy">
          <h1>{title}</h1>
          {renderLink ? (
            renderLink('/occasions/new', 'btn planner-create', createLabel)
          ) : (
            <span className="btn planner-create">{createLabel}</span>
          )}
        </div>
        <div className="planner-cover-art" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
      {events.length === 0 && <div className="notice">{emptyLabel}</div>}
      <ul className="planner-events">
        {events.map((event) => {
          const fields = (
            <>
              <span className="planner-event-date">{event.date}</span>
              <h2>{event.title}</h2>
              <span className="planner-event-status">{event.status}</span>
              <span className="planner-event-arrow" aria-hidden="true">
                ↗
              </span>
            </>
          );
          return (
            <li key={event.id}>
              {renderLink ? (
                renderLink('/occasions/' + event.id, 'planner-event card link', fields)
              ) : (
                <div className="planner-event card link">{fields}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Container>
  );
}
