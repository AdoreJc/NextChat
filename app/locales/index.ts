import cn from "./cn";
import en from "./en";
import pt from "./pt";
import tw from "./tw";
import da from "./da";
import id from "./id";
import fr from "./fr";
import es from "./es";
import it from "./it";
import tr from "./tr";
import jp from "./jp";
import de from "./de";
import vi from "./vi";
import ru from "./ru";
import no from "./no";
import cs from "./cs";
import ko from "./ko";
import ar from "./ar";
import bn from "./bn";
import sk from "./sk";
import { merge } from "../utils/merge";
import { FEATURES } from "../config/site";
import { safeLocalStorage } from "@/app/utils";

import type { LocaleType } from "./cn";
export type { LocaleType, PartialLocaleType } from "./cn";

const localStorage = safeLocalStorage();

const ALL_LANGS = {
  cn,
  en,
  tw,
  pt,
  da,
  jp,
  ko,
  id,
  fr,
  es,
  it,
  tr,
  de,
  vi,
  ru,
  cs,
  no,
  ar,
  bn,
  sk,
};

export type Lang = keyof typeof ALL_LANGS;

export const AllLangs = Object.keys(ALL_LANGS) as Lang[];

export const ALL_LANG_OPTIONS: Record<Lang, string> = {
  cn: "简体中文",
  en: "English",
  pt: "Português",
  tw: "繁體中文",
  da: "Dansk",
  jp: "日本語",
  ko: "한국어",
  id: "Indonesia",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  tr: "Türkçe",
  de: "Deutsch",
  vi: "Tiếng Việt",
  ru: "Русский",
  cs: "Čeština",
  no: "Nynorsk",
  ar: "العربية",
  bn: "বাংলা",
  sk: "Slovensky",
};

const LANG_KEY = "lang";
const DEFAULT_LANG = "en";

const fallbackLang = en;
const targetLang = ALL_LANGS[getLang()] as LocaleType;

// if target lang missing some fields, it will use fallback lang string
merge(fallbackLang, targetLang);

// single-site build: the upstream "unauthorized" hint advertises the upstream
// SaaS in every language, replace it with a hint about this site
if (!FEATURES.upstreamLinks) {
  const SITE_UNAUTHORIZED: Partial<Record<Lang, string>> = {
    en: "🔑 The API key is missing or invalid. Open this page from the chat link in your API console, or [fill in the endpoint and API key in settings](/#/settings).",
    cn: "🔑 缺少 API Key 或 Key 无效。请从 API 控制台的聊天链接进入本页，或在[设置](/#/settings)里填写接口地址和 API Key。",
    tw: "🔑 缺少 API Key 或 Key 無效。請從 API 控制台的聊天連結進入本頁，或在[設定](/#/settings)裡填寫介面位址和 API Key。",
  };
  fallbackLang.Error.Unauthorized =
    SITE_UNAUTHORIZED[getLang()] ?? (SITE_UNAUTHORIZED.en as string);
}

export default fallbackLang as LocaleType;

function getItem(key: string) {
  return localStorage.getItem(key);
}

function setItem(key: string, value: string) {
  localStorage.setItem(key, value);
}

function getLanguage() {
  try {
    const locale = new Intl.Locale(navigator.language).maximize();
    const region = locale?.region?.toLowerCase();
    // 1. check region code in ALL_LANGS
    if (AllLangs.includes(region as Lang)) {
      return region as Lang;
    }
    // 2. check language code in ALL_LANGS
    if (AllLangs.includes(locale.language as Lang)) {
      return locale.language as Lang;
    }
    return DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

export function getLang(): Lang {
  const savedLang = getItem(LANG_KEY);

  if (AllLangs.includes((savedLang ?? "") as Lang)) {
    return savedLang as Lang;
  }

  return getLanguage();
}

export function changeLang(lang: Lang) {
  setItem(LANG_KEY, lang);
  location.reload();
}

export function getISOLang() {
  const isoLangString: Record<string, string> = {
    cn: "zh-Hans",
    tw: "zh-Hant",
  };

  const lang = getLang();
  return isoLangString[lang] ?? lang;
}

const DEFAULT_STT_LANG = "zh-CN";
export const STT_LANG_MAP: Record<Lang, string> = {
  cn: "zh-CN",
  en: "en-US",
  pt: "pt-BR",
  tw: "zh-TW",
  da: "da-DK",
  jp: "ja-JP",
  ko: "ko-KR",
  id: "id-ID",
  fr: "fr-FR",
  es: "es-ES",
  it: "it-IT",
  tr: "tr-TR",
  de: "de-DE",
  vi: "vi-VN",
  ru: "ru-RU",
  cs: "cs-CZ",
  no: "no-NO",
  ar: "ar-SA",
  bn: "bn-BD",
  sk: "sk-SK",
};

export function getSTTLang(): string {
  try {
    return STT_LANG_MAP[getLang()];
  } catch {
    return DEFAULT_STT_LANG;
  }
}
