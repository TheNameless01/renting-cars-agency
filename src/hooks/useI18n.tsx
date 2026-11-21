import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppLanguage, NumeralSystem } from '../../shared/types/domain.ts';
import { translations, type TranslationDict } from '../i18n/translations.ts';

interface I18nContextValue {
  lang: AppLanguage;
  dir: 'ltr' | 'rtl';
  numerals: NumeralSystem;
  t: TranslationDict;
  setLang: (next: AppLanguage) => void;
  toggleLang: () => void;
  setNumerals: (next: NumeralSystem) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLang = 'fr',
  initialNumerals = 'latin',
}: {
  children: ReactNode;
  initialLang?: AppLanguage;
  initialNumerals?: NumeralSystem;
}) {
  const [lang, setLangState] = useState<AppLanguage>(initialLang);
  const [numerals, setNumerals] = useState<NumeralSystem>(initialNumerals);
  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: AppLanguage) => {
    setLangState(next);
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => (prev === 'fr' ? 'ar' : 'fr'));
  }, []);

  return (
    <I18nContext.Provider
      value={{
        lang,
        dir,
        numerals,
        t: translations[lang],
        setLang,
        toggleLang,
        setNumerals,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return ctx;
}
