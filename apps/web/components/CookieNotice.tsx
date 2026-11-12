'use client';

import { useEffect, useState } from 'react';
import { useT } from './LangProvider';

const STORAGE_KEY = 'ed_cookie_notice';

// LAU1: the cookie notice is shown once inside the app (the public site sets no
// cookies, D1), lists the three cookies actually used, states that none is used for
// tracking or advertising, and is re-shown only when the cookie set changes — the
// acknowledgement in localStorage is keyed by the cookie-set signature.
export function CookieNotice({ signature }: { signature: string }) {
  const t = useT();
  const [visible, setVisible] = useState(true); // SSR-visible: works without JS too
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === signature) setVisible(false);
    } catch {
      // private mode etc. — keep the notice visible
    }
  }, [signature]);
  if (!visible) return null;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://eventdesk.ro';
  return (
    <div className="notice" role="region" aria-label={t('lau.notice.title')}>
      <strong>{t('lau.notice.title')}</strong> {t('lau.notice.body')} <code>ed_session</code>,{' '}
      <code>ed_device</code>, <code>ed_lang</code> — {t('lau.notice.none_tracking')}{' '}
      <a href={`${site}/legal/cookies`} rel="noopener noreferrer">
        {t('lau.notice.more')}
      </a>{' '}
      <button
        type="button"
        className="btn secondary"
        onClick={() => {
          try {
            window.localStorage.setItem(STORAGE_KEY, signature);
          } catch {
            // ignore — notice stays visible next visit
          }
          setVisible(false);
        }}
      >
        {t('lau.notice.ok')}
      </button>
    </div>
  );
}
