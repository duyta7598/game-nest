import translations from './translations.json';
export type Language = 'en' | 'vi';
export type TranslationParams = Record<string, string | number>;
export type Translator = (text: string, params?: TranslationParams) => string;
const entries = Object.entries(translations);
const dictionary: Record<string, string> = translations;
const reverse = new Map(entries.map(([vi, en]) => [en, vi]));
const fill = (text: string, params: TranslationParams) =>
  text.replace(/\{(\d+)\}/g, (match, key: string) => String(params[key] ?? match));
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = entries
  .filter(([vi]) => /\{\d+\}/.test(vi))
  .map(([vi, en]) => ({
    vi,
    en,
    patterns: [vi, en].map(
      (text) =>
        new RegExp(
          `^${text
            .split(/\{\d+\}/)
            .map(escapePattern)
            .join('(.*?)')}$`,
          's',
        ),
    ),
  }));
export function translate(
  text: string,
  language: Language = 'en',
  params: TranslationParams = {},
): string {
  const source = text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  if (source.startsWith('[')) {
    try {
      const issues: unknown = JSON.parse(source);
      if (
        Array.isArray(issues) &&
        issues.length &&
        issues.every((issue) => typeof issue?.message === 'string')
      ) {
        return issues
          .map((issue) =>
            translate(
              Object.hasOwn(dictionary, issue.message)
                ? issue.message
                : 'Giá trị cài đặt không hợp lệ.',
              language,
            ),
          )
          .join('\n');
      }
    } catch {}
  }
  const vi = Object.hasOwn(dictionary, source) ? source : reverse.get(source);
  if (vi !== undefined) return fill(language === 'vi' ? vi : dictionary[vi], params);
  for (const template of templates) {
    for (const pattern of template.patterns) {
      const match = source.match(pattern);
      if (!match) continue;
      const values = Object.fromEntries(
        match.slice(1).map((value, index) => [String(index), translate(value, language)]),
      );
      return fill(language === 'vi' ? template.vi : template.en, values);
    }
  }
  return source;
}
