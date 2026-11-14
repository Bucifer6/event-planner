import { expect, it } from 'vitest';
import { TEMPLATE_KINDS } from '@eventdesk/core';
import { messages } from '@eventdesk/i18n';
import {
  additionalOccasionKinds,
  findInvitationTemplate,
  invitationTemplates,
} from '../app/lib/invitation-templates';
import { readFileSync } from 'node:fs';
import { stitchwork } from '../components/InvitationStitchwork';

it('offers 200 library presets and three curated ranges per selectable occasion type', () => {
  const seen = new Set<string>();
  const css = readFileSync(new URL('../components/invitation-card.css', import.meta.url), 'utf8');
  const kinds = [...TEMPLATE_KINDS, ...additionalOccasionKinds, 'custom'];
  for (const kind of kinds) {
    const templates = invitationTemplates(kind);
    expect(templates.filter(({ range }) => range === 'all_designs')).toHaveLength(200);
    expect(templates.filter(({ range }) => range === 'featured')).toHaveLength(6);
    expect(templates.filter(({ range }) => range === 'rustic')).toHaveLength(11);
    expect(templates.filter(({ range }) => range === 'traditional')).toHaveLength(11);
    expect(templates.filter(({ range }) => range === 'embroidery')).toHaveLength(16);
    for (const dictionary of Object.values(messages)) {
      expect(dictionary['templates.' + kind + '.name']).toBeTruthy();
    }
    for (const template of templates) {
      expect(seen.has(template.id)).toBe(false);
      seen.add(template.id);
      expect(findInvitationTemplate(template.id)).toEqual(template);
      expect(css).toContain("[data-palette='" + template.palette + "']");
      if (template.range === 'embroidery') {
        expect(stitchwork[template.composition].cells.length).toBeGreaterThan(0);
      } else {
        expect(css.includes("[data-composition='" + template.composition + "']")).toBe(true);
      }
      for (const dictionary of Object.values(messages)) {
        expect(dictionary['c.inv.palette.' + template.palette]).toBeTruthy();
        expect(dictionary['c.inv.composition.' + template.composition]).toBeTruthy();
        expect(dictionary['c.inv.wording.' + kind + '.' + template.wording]).toBeTruthy();
      }
    }
  }
  expect(seen.size).toBe(kinds.length * 244);
  expect(findInvitationTemplate('picnic.orchard.frame')?.composition).toBe('frame');
  expect(findInvitationTemplate('reuniune.evergreen.duotone')?.composition).toBe('duotone');
  expect(findInvitationTemplate('picnic.silk.frame')).toBeUndefined();
  expect(findInvitationTemplate('picnic.archive-cloth.muscel-chest')).toBeUndefined();
  expect(invitationTemplates('legacy-kind')).toEqual(invitationTemplates('custom'));
});
