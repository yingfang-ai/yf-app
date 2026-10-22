import { zhCNLocale } from "./messages/zh-CN";
import type { Locale, LocalePlugin } from "./types";

const localePlugins: LocalePlugin[] = [zhCNLocale];

/**
 * 根据标识获取已注册的语言包。
 * @param id 要查询的语言标识
 * @returns 已注册的语言包，不存在时返回 undefined
 */
export function getLocalePlugin(id: string): LocalePlugin | undefined {
  return localePlugins.find((plugin) => plugin.id === id);
}

/** 获取当前已注册语言的稳定顺序列表。 */
export function getSupportedLocales(): string[] {
  return localePlugins.map((plugin) => plugin.id);
}

/**
 * 将浏览器语言列表解析为内置语言。产品只有简体中文（yingfang#28 R12），
 * 任何浏览器语言都解析到 zh-CN；机制保留（日后增补语言包只需注册并在此判断）。
 * @param _languages 浏览器按优先级排列的语言列表（当前不影响结果）
 */
export function resolveBrowserLocale(_languages: readonly string[]): Locale {
  return "zh-CN";
}
