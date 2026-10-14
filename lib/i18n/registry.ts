import { zhCNLocale } from "./messages/zh-CN";
import type { Locale, LocalePlugin } from "./types";

// yf-app 仅内置简体中文（zh-CN 单 locale；spec「部署/UI」Requirement）。
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
 * 将浏览器语言列表解析为 yf-app 的内置语言。
 * @param _languages 浏览器按优先级排列的语言列表（保留参数位以兼容调用方；zh-CN 是唯一内置语言）
 * @returns 恒为 zh-CN（不做多语言降级）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 参数保留以兼容调用方签名。
export function resolveBrowserLocale(_languages: readonly string[]): Locale {
  return "zh-CN";
}
