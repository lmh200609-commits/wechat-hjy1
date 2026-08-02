const test = require("node:test");
const assert = require("node:assert/strict");
const validators = require("../validators/admin-content.validators");

test("article payload supports ordered text and multiple image blocks", () => {
  const result = validators.articleCreate({ body: {
    title: "紫檀辨伪入门", tag: "材质辨识", summary: "从纹理、密度与气味认识小叶紫檀真伪。",
    authorName: "永乐文玩", coverMediaId: "11", readingMinutes: 6, isHot: true, status: "PUBLISHED",
    body: [
      { id: "h1", type: "heading", text: "一、细看其里" },
      { id: "p1", type: "paragraph", text: "金星与牛毛纹需要结合密度和棕眼综合判断。" },
      { id: "i1", type: "image", mediaId: "12", caption: "纹理细节" },
      { id: "i2", type: "IMAGE", mediaId: "13", caption: "实物对照" },
    ],
  } });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value.body.filter((block) => block.type === "IMAGE").map((block) => block.mediaId), ["12", "13"]);
});

test("homepage configuration requires five unique enabled-category candidates", () => {
  const valid = validators.quickCategories({ body: { version: 1, items: [1, 2, 3, 4, 5].map((value) => ({ categoryId: String(value), iconText: "雅" })) } });
  assert.equal(valid.valid, true);
  const duplicate = validators.quickCategories({ body: { version: 1, items: [1, 1, 2, 3, 4].map((value) => ({ categoryId: String(value), iconText: "雅" })) } });
  assert.equal(duplicate.valid, false);
});

test("Banner target is an optional existing product id instead of a raw path", () => {
  const result = validators.bannerCreate({ body: { title: "文房清供", subtitle: "案上山河", imageMediaId: "9", targetProductId: null, visible: true } });
  assert.equal(result.valid, true);
  assert.equal(result.value.targetProductId, null);
});
