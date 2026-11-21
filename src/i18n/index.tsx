import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { en } from './en';
import { it } from './it';

type Widen<T> = T extends (...args: infer A) => string ? (...args: A) => string
  : T extends string ? string
  : { -readonly [K in keyof T]: Widen<T[K]> };

/** Shape of every dictionary: en's keys, each a string or a function returning one. */
export type Messages = Widen<typeof en>;
export type Lang = 'en' | 'it';

export const DICTS: Record<Lang, Messages> = { en, it };
export const LANGS: readonly Lang[] = ['en', 'it'];
const LANG_KEY = 'fgo-solver:lang';

function initialLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'it' ? 'it' : 'en';
  } catch {
    return 'en';
  }
}

interface I18nState { lang: Lang; setLang: (l: Lang) => void; t: Messages }
const Ctx = createContext<I18nState>({ lang: 'en', setLang: () => {}, t: en });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = (l: Lang) => {
    try { localStorage.setItem(LANG_KEY, l); } catch { /* storage unavailable */ }
    setLangState(l);
  };
  return <Ctx.Provider value={{ lang, setLang, t: DICTS[lang] }}>{children}</Ctx.Provider>;
}

export const useT = (): Messages => useContext(Ctx).t;
export const useLang = (): [Lang, (l: Lang) => void] => {
  const { lang, setLang } = useContext(Ctx);
  return [lang, setLang];
};
