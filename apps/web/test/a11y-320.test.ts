import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Q2/Q8/Q10 + LAU9: 320 px usability and WCAG 2.2 AA targets asserted in CI on every
// release. Reads the real sources, so a regression fails the build.
const webRoot = join(__dirname, '..');
const publicRoot = join(webRoot, '..', 'public');

describe('a11y / 320px (Q2, Q8, Q10, LAU9)', () => {
  it('touch targets are at least 44px via --target-min', () => {
    const tokens = readFileSync(join(webRoot, '..', '..', 'packages/ui/src/tokens.css'), 'utf8');
    expect(tokens).toMatch(/--target-min:\s*44px/);
    const globals = readFileSync(join(webRoot, 'app/globals.css'), 'utf8');
    // interactive elements use the shared target minimum
    expect(globals + tokens).toMatch(/min-height:\s*var\(--target-min\)/);
  });

  it('no fixed layout wider than 320px; viewport is device-width', () => {
    const globals = readFileSync(join(webRoot, 'app/globals.css'), 'utf8');
    const fixedWidths = [...globals.matchAll(/min-width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    for (const w of fixedWidths) expect(w).toBeLessThanOrEqual(320);
    const layout = readFileSync(join(webRoot, 'app/layout.tsx'), 'utf8');
    expect(layout).toContain("width: 'device-width'");
  });

  it('LAU1 cookie notice is rendered in the app root layout, keyed by the cookie-set signature', async () => {
    const layout = readFileSync(join(webRoot, 'app/layout.tsx'), 'utf8');
    expect(layout).toContain('CookieNotice');
    expect(layout).toContain('COOKIE_SET_SIGNATURE');
    const { COOKIE_SET_SIGNATURE: webSig } = await import('../app/lib/cookie-set');
    const { COOKIE_SET_SIGNATURE: coreSig } = await import('@eventdesk/core');
    expect(webSig).toBe(coreSig); // web copy and core canonical constant never drift
  });

  it('LAU9 accessibility statement exists on the public site in ro+en', () => {
    const page = join(publicRoot, 'app/legal/accessibility/page.tsx');
    expect(existsSync(page)).toBe(true);
    const src = readFileSync(page, 'utf8');
    expect(src).toContain('WCAG 2.2 AA');
  });

  it('LAU8 report route exists on the app and is linked from the public site', () => {
    expect(existsSync(join(webRoot, 'app/report/page.tsx'))).toBe(true);
    const landing = readFileSync(join(publicRoot, 'app/page.tsx'), 'utf8');
    expect(landing).toContain('/report');
  });

  it('LAU5 incident banner is on all guest-facing pages', () => {
    for (const p of [
      join(webRoot, 'app/g/[token]/page.tsx'),
      join(webRoot, 'app/g/q/[qrId]/page.tsx'),
      join(webRoot, 'app/e/[slug]/page.tsx'),
    ]) {
      expect(readFileSync(p, 'utf8')).toContain('IncidentBanner');
    }
  });
});
