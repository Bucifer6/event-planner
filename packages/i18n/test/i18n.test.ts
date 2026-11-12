import { describe, expect, it } from 'vitest';
import { assertDictionariesInSync, messages, t } from '../src/index.js';

describe('L1/L2: locale dictionaries', () => {
  it('ro and en dictionaries have identical keys', () => {
    assertDictionariesInSync();
  });

  it('romanian diacritics are present and default locale is ro', () => {
    expect(messages.ro['guests.children.note']).toContain('gospodărie');
    expect(t('ro', 'templates.nunta.name')).toBe('Nuntă');
    expect(t('en', 'templates.nunta.name')).toBe('Wedding');
    expect(t('ro', 'rsvp.welcome', { occasion: 'X' })).toContain('X');
  });
});
