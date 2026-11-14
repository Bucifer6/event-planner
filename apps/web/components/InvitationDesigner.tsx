'use client';

import { useState } from 'react';
import { t, type Locale } from '@eventdesk/i18n';
import {
  invitationRanges,
  invitationTemplates,
  type InvitationKind,
} from '../app/lib/invitation-templates';
import { InvitationCard } from './InvitationCard';

export function InvitationDesigner({
  kind,
  locale,
  title,
  detail,
  action,
}: {
  kind: InvitationKind;
  locale: Locale;
  title: string;
  detail?: string;
  action: (data: FormData) => Promise<void>;
}) {
  const templates = invitationTemplates(kind);
  const [selectedId, selectTemplate] = useState('');
  const [text, setText] = useState('');
  const [palette, setPalette] = useState('');
  const [range, setRange] = useState<(typeof invitationRanges)[number]>('embroidery');
  const showPalette = range === 'all_designs';
  const selected = templates.find((template) => template.id === selectedId);
  const translate = (key: string, values?: Record<string, string | number>) =>
    t(locale, 'c.inv.' + key, values);

  return (
    <div className="invitation-designer">
      <details open className="invitation-gallery">
        <summary>{translate('gallery', { count: templates.length })}</summary>
        <div className="invitation-gallery-filters" aria-label={translate('choose')}>
          {invitationRanges.map((option) => (
            <button
              type="button"
              key={option}
              className="btn secondary"
              aria-pressed={range === option}
              onClick={() => {
                setRange(option);
                setPalette('');
              }}
            >
              {translate(option)}
            </button>
          ))}
        </div>
        {showPalette && <label htmlFor="invitation-palette">{translate('palette')}</label>}
        <select
          id="invitation-palette"
          value={palette}
          hidden={!showPalette}
          onChange={(event) => setPalette(event.target.value)}
        >
          <option value="">{translate('all_palettes')}</option>
          {[...new Set(templates.map((template) => template.palette))].map((option) => (
            <option key={option} value={option}>
              {translate('palette.' + option)}
            </option>
          ))}
        </select>
        <fieldset>
          <legend className="invitation-sr-only">{translate('choose')}</legend>
          <div className="invitation-gallery-grid">
            {templates
              .filter(
                (template) =>
                  (showPalette || template.range === range) &&
                  (!palette || template.palette === palette)
              )
              .map((template) => {
                const layout = translate('composition.' + template.composition);
                const name =
                  template.range === 'embroidery'
                    ? layout
                    : translate('template_name', {
                        palette: translate('palette.' + template.palette),
                        layout,
                      });
                return (
                  <label className="invitation-option" key={template.id}>
                    <input
                      type="radio"
                      className="invitation-sr-only"
                      name="template-choice"
                      checked={selectedId === template.id}
                      onChange={() => {
                        selectTemplate(template.id);
                        const previousStarter = selected
                          ? translate('wording.' + kind + '.' + selected.wording)
                          : '';
                        if (!text.trim() || text === previousStarter) {
                          setText(translate('wording.' + kind + '.' + template.wording));
                        }
                      }}
                    />
                    <InvitationCard template={template} thumbnail title={title} text="" />
                    <span className="invitation-option-name">{name}</span>
                  </label>
                );
              })}
          </div>
        </fieldset>
      </details>
      <form className="invitation-editor" action={action}>
        {selected && <input type="hidden" name="templateId" value={selected.id} />}
        <label htmlFor="invitation-text">{translate('text')}</label>
        <textarea
          id="invitation-text"
          name="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          required
        />
        {selected ? (
          <>
            <h3>{translate('preview')}</h3>
            <InvitationCard template={selected} title={title} detail={detail} text={text} />
          </>
        ) : (
          <>
            <label htmlFor="invitation-layout">{translate('layout')}</label>
            <select id="invitation-layout" name="layout" defaultValue="classic">
              <option value="classic">{translate('layout.classic')}</option>
              <option value="minimal">{translate('layout.minimal')}</option>
            </select>
          </>
        )}
        <div className="actions">
          <button className="btn" type="submit">
            {translate('new_version')}
          </button>
          {selected && (
            <button type="button" className="btn secondary" onClick={() => selectTemplate('')}>
              {translate('clear')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
