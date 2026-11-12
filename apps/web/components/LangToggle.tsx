'use client';

import { useLocale } from './LangProvider';

// L2: the toggle changes wording only, never data. Sets the language cookie and reloads.
export function LangToggle({ guestBase }: { guestBase?: string }) {
  const locale = useLocale();
  const next = locale === 'ro' ? 'en' : 'ro';
  return (
    <button
      type="button"
      className="btn secondary"
      onClick={() => {
        document.cookie = `ed_lang=${next}; path=/; max-age=31536000; samesite=lax`;
        if (guestBase) {
          const url = new URL(guestBase, window.location.origin);
          url.searchParams.set('lang', next);
          window.location.href = url.toString();
        } else {
          window.location.reload();
        }
      }}
    >
      {locale === 'ro' ? 'English' : 'Română'}
    </button>
  );
}
