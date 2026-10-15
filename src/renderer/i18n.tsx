import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { type Language, type Translator, translate } from '../shared/i18n';

const LanguageContext = createContext<{
  language: Language;
  setLanguage: (value: Language) => void;
  t: Translator;
} | null>(null);
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('en');
  const t: Translator = useCallback(
    (text, params) => translate(text, language, params),
    [language],
  );
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const value = useMemo(() => ({ language, setLanguage, t }), [language, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('Language provider is missing.');
  return context;
}
