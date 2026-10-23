import type { ExplorerRoot } from "@/lib/explorer-roots";

/**
 * 普通用户 explorer 的画廊分区（R10 读面，owner 决定 6：文件浏览器当生成图
 * 画廊）：画廊布局在服务端（`<数据根>/gallery/<user_id>/…`），根路径经
 * `/api/yf/me` 的 `gallery_root` 带给客户端，这里只把它折成一个 explorer
 * 分区。运营者不折（他们的文件根是会话 cwd 并集，任意目录可自行登记）；
 * 身份未加载（me=null）/匿名按普通用户处理，不闪。
 */
export const OWN_GALLERY_SECTION_KEY = "yf-own-gallery";
export const OWN_GALLERY_SECTION_LABEL = "我的画廊";

export interface YfMeForGallery {
  operator: boolean;
  gallery_root?: string | null;
}

export function ownGallerySection(me: YfMeForGallery | null): ExplorerRoot | null {
  if (!me || me.operator || !me.gallery_root) return null;
  return {
    key: OWN_GALLERY_SECTION_KEY,
    root: me.gallery_root,
    displayName: OWN_GALLERY_SECTION_LABEL,
  };
}