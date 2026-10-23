import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// 画廊分区（R10 读面，verification rewind fix 3）：普通用户 explorer 的
// 「我的画廊」分区来自 /api/yf/me 的 gallery_root；运营者/未加载身份不折。

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const {
  ownGallerySection,
  OWN_GALLERY_SECTION_KEY,
  OWN_GALLERY_SECTION_LABEL,
} = await jiti.import("./gallery-section.ts");
const { buildExplorerRoots } = await jiti.import("../explorer-roots.ts");

test("an ordinary user with a gallery root gets one own-gallery section", () => {
  const me = { operator: false, gallery_root: "/data/gallery/aaaa" };
  assert.deepEqual(ownGallerySection(me), {
    key: OWN_GALLERY_SECTION_KEY,
    root: "/data/gallery/aaaa",
    displayName: OWN_GALLERY_SECTION_LABEL,
  });
});

test("operators, unloaded identities and missing roots get no gallery section", () => {
  assert.equal(ownGallerySection(null), null);
  assert.equal(ownGallerySection({ operator: true, gallery_root: "/data/gallery/op" }), null);
  assert.equal(ownGallerySection({ operator: false }), null);
  assert.equal(ownGallerySection({ operator: false, gallery_root: null }), null);
});

test("the gallery section rides the explorer root builder with pinned dirs and the selection", () => {
  const pinned = [{ key: "/w", root: "/w" }];
  const gallery = ownGallerySection({ operator: false, gallery_root: "/data/gallery/u" });
  const roots = buildExplorerRoots([...pinned, gallery], { key: "/sel", root: "/sel" });
  assert.deepEqual(roots.map((r) => r.key), ["/w", OWN_GALLERY_SECTION_KEY, "/sel"]);
  assert.deepEqual(roots.map((r) => r.root), ["/w", "/data/gallery/u", "/sel"]);
  // 画廊分区键稳定：不与任何 pinned/selected 键冲突（dedupe 永不吃掉它）。
  const dup = buildExplorerRoots([...pinned, gallery, gallery], null);
  assert.equal(dup.filter((r) => r.key === OWN_GALLERY_SECTION_KEY).length, 1);
});