'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Locale } from '@eventdesk/i18n';
import { t } from '@eventdesk/i18n';

const LangContext = createContext<Locale>('ro');

export function LangProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LangContext.Provider value={locale}>{children}</LangContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LangContext);
}

export function useT() {
  const locale = useLocale();
  return (key: string, params?: Record<string, string | number>) => t(locale, key, params);
}
