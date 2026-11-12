import { describe, expect, it } from 'vitest';
import { securityHeaders } from '../app/lib/headers';

// SEC5: asserted in CI on every release (Q1).
describe('security headers (SEC5)', () => {
  it('sets strict CSP, HSTS, nosniff and same-origin referrer policy', () => {
    const h = securityHeaders('testnonce123');
    expect(h['Content-Security-Policy']).toContain("default-src 'self'");
    expect(h['Content-Security-Policy']).toContain("'nonce-testnonce123'");
    expect(h['Content-Security-Policy']).toContain("object-src 'none'");
    expect(h['Content-Security-Policy']).not.toContain('unsafe-inline');
    // no third-party origins anywhere in the CSP
    const csp = h['Content-Security-Policy']!;
    expect(csp).not.toMatch(/https?:\/\//);
    expect(h['Strict-Transport-Security']).toContain('max-age=63072000');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('same-origin');
    expect(h['X-Frame-Options']).toBe('DENY');
  });
});
