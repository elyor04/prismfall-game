import { createContext, ReactNode, useContext, useMemo } from "react";
import { en } from "./en";
import { ru } from "./ru";
import { uz } from "./uz";

export type Lang = "en" | "ru" | "uz";
export const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ru", label: "Русский" },
  { id: "uz", label: "Oʻzbekcha" },
];

type Plural = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };
type En = typeof en;
/** Every language must define every English key, with the same shape. */
export type Dict = { [K in keyof En]: En[K] extends string ? string : Plural };
export type Key = keyof En;
export type Params = Record<string, string | number>;

const DICTS: Record<Lang, Dict> = { en, ru, uz };

const LOCALE: Record<Lang, string> = { en: "en-US", ru: "ru-RU", uz: "uz-Latn-UZ" };

/** Map a stored setting ("" = follow the device) to a concrete language. */
export function resolveLang(setting: string | undefined): Lang {
  if (setting === "en" || setting === "ru" || setting === "uz") return setting;
  const prefs = typeof navigator !== "undefined" ? [...(navigator.languages ?? []), navigator.language] : [];
  for (const p of prefs) {
    const l = (p || "").toLowerCase();
    if (l.startsWith("uz")) return "uz";
    if (l.startsWith("ru")) return "ru";
    if (l.startsWith("en")) return "en";
  }
  return "en";
}

function fill(s: string, params?: Params, locale?: string) {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = params[k];
    if (v === undefined) return m;
    return typeof v === "number" && locale ? new Intl.NumberFormat(locale).format(v) : String(v);
  });
}

export interface I18n {
  lang: Lang;
  locale: string;
  t: (key: Key, params?: Params) => string;
  /** Pluralised lookup; `n` is also available as {n}. */
  tn: (key: Key, n: number, params?: Params) => string;
  /** Lookup for keys built at runtime (ids from Go or the engine). */
  td: (key: string, params?: Params, fallback?: string) => string;
  num: (n: number) => string;
  date: (iso: string) => string;
  list: (items: string[]) => string;
}

export function makeI18n(lang: Lang): I18n {
  const dict = DICTS[lang];
  const locale = LOCALE[lang];
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  let plural: Intl.PluralRules;
  try {
    plural = new Intl.PluralRules(locale);
  } catch {
    plural = new Intl.PluralRules("en-US");
  }
  const raw = (key: string): string | Plural | undefined =>
    (dict as Record<string, string | Plural>)[key] ?? (en as Record<string, string | Plural>)[key];
  const asText = (v: string | Plural | undefined, n?: number): string | undefined => {
    if (v === undefined) return undefined;
    if (typeof v === "string") return v;
    const cat = plural.select(n ?? 0) as keyof Plural;
    return v[cat] ?? v.other;
  };
  return {
    lang,
    locale,
    t: (key, params) => fill(asText(raw(key)) ?? key, params, locale),
    tn: (key, n, params) => fill(asText(raw(key), n) ?? key, { n, ...params }, locale),
    td: (key, params, fallback) => {
      const v = asText(raw(key));
      return v === undefined ? (fallback ?? key) : fill(v, params, locale);
    },
    num: (n) => nf.format(Math.round(n)),
    date: (iso) => {
      const d = new Date(iso);
      return isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale);
    },
    // Not Intl.ListFormat: WebViews often lack Uzbek list data and fall back to English.
    list: (items) => {
      if (items.length <= 1) return items.join("");
      const and = asText(raw("common.and")) ?? "and";
      return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
    },
  };
}

const Ctx = createContext<I18n>(makeI18n("en"));

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo(() => makeI18n(lang), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}

/**
 * Render a translated template whose {placeholders} are React nodes,
 * e.g. key hints with <kbd> elements inside a sentence.
 */
export function rich(template: string, nodes: Record<string, ReactNode>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(template))) {
    if (m.index > last) out.push(<span key={`t${i++}`}>{template.slice(last, m.index)}</span>);
    out.push(<span key={`n${i++}`}>{nodes[m[1]] ?? m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push(<span key={`t${i++}`}>{template.slice(last)}</span>);
  return out;
}

/** Translate a Go GameError (its code arrives in `cause.code`). */
export function errorText(i18n: I18n, e: unknown): string {
  const code = (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  if (code) return i18n.td(`error.${code}`, undefined, i18n.t("error.generic"));
  return i18n.t("error.generic");
}
