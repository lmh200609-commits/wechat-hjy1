const test = require("node:test");
const assert = require("node:assert/strict");

const validators = require("../validators/public.validators");

test("product query validator normalizes supported filters", () => {
  const result = validators.products({
    query: {
      page: "2",
      pageSize: "10",
      categoryId: "12",
      materialId: "21",
      keyword: "  紫檀  ",
      sort: "price_asc",
      inStock: "true",
      minPriceAmount: "100",
      maxPriceAmount: "20000",
    },
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, {
    page: 2,
    pageSize: 10,
    categoryId: "12",
    materialId: "21",
    keyword: "紫檀",
    sort: "PRICE_ASC",
    inStock: true,
    minPriceAmount: 100,
    maxPriceAmount: 20000,
  });
});

test("product query validator rejects unsafe paging and invalid ranges", () => {
  assert.equal(validators.products({ query: { pageSize: "51" } }).code, "PAGE_SIZE_OUT_OF_RANGE");
  assert.equal(validators.products({ query: { minPriceAmount: "200", maxPriceAmount: "100" } }).valid, false);
  assert.equal(validators.products({ query: { categoryId: "p-01" } }).valid, false);
});

test("route validators only accept positive database identifiers", () => {
  assert.deepEqual(validators.productDetail({ params: { productId: "123" } }).value, { productId: "123" });
  assert.equal(validators.articleDetail({ params: { articleId: "0" } }).valid, false);
  assert.equal(validators.collectionDetail({ params: { collectionId: "../1" } }).valid, false);
});
