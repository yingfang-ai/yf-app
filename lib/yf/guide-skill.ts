import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 引导 skill（plan step 11，R8）：in-repo 定义 `config/guide-skill/SKILL.md`，普通
 * 用户的会话（cwd 在 `<数据根>/users/` 之内，见 rpc-manager 的 userChatSession）
 * 把它作为系统提示注入——新对话「默认就在引导 skill 里」，没有手动调用步骤。
 * 运营者会话不受影响。
 */
export const GUIDE_SKILL_MARKER = "YF-GUIDE-SKILL";

export function guideSkillPath(): string {
  return join(process.cwd(), "config", "guide-skill", "SKILL.md");
}

/** 去掉 SKILL.md 的 frontmatter，只留正文（提示词）。 */
export function stripFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(markdown);
  return (match ? markdown.slice(match[0].length) : markdown).trim();
}

/** 读引导 skill 正文；文件缺失即显式报错（引导是产品主路径，不静默降级成裸聊天）。 */
export function loadGuideSkillPrompt(): string {
  const text = stripFrontmatter(readFileSync(guideSkillPath(), "utf8"));
  if (!text.includes(GUIDE_SKILL_MARKER)) {
    throw new Error(`引导 skill 缺少稳定标记 ${GUIDE_SKILL_MARKER}：${guideSkillPath()}`);
  }
  return text;
}
