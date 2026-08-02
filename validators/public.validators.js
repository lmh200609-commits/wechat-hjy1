const SORT_VALUES = new Set(["DEFAULT", "NEWEST", "PRICE_ASC", "PRICE_DESC", "SALES_DESC"]);
const DIMENSION_VALUES = new Set(["ALL", "PRODUCT_CATEGORY", "MATERIAL"]);

function invalid(field, message, code = "INVALID_ARGUMENT") {
  return { valid: false, errors: [{ field, message }], code };
}

function parsePage(query) {
  const rawPage = query.page == null ? "1" : String(query.page);
  const rawPageSize = query.pageSize == null ? "20" : String(query.pageSize);
  if (!/^\d+$/.test(rawPage) || Number(rawPage) < 1) return invalid("page", "page must be an integer greater than or equal to 1");
  if (!/^\d+$/.test(rawPageSize) || Number(rawPageSize) < 1 || Number(rawPageSize) > 50) {
    return invalid("pageSize", "pageSize must be an integer between 1 and 50", "PAGE_SIZE_OUT_OF_RANGE");
  }
  return { page: Number(rawPage), pageSize: Number(rawPageSize) };
}

function parseId(value, field) {
  const text = String(value == null ? "" : value).trim();
  if (!/^[1-9]\d*$/.test(text)) return invalid(field, `${field} must be a positive integer string`);
  return text;
}

function parseOptionalId(value, field) {
  if (value == null || String(value).trim() === "") return null;
  return parseId(value, field);
}

function parseBoolean(value, field) {
  if (value == null || value === "") return undefined;
  const text = String(value).toLowerCase();
  if (["true", "1"].includes(text)) return true;
  if (["false", "0"].includes(text)) return false;
  return invalid(field, `${field} must be true or false`);
}

function parseAmount(value, field) {
  if (value == null || value === "") return undefined;
  const text = String(value);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
    return invalid(field, `${field} must be a non-negative safe integer`);
  }
  return Number(text);
}

function categories({ query }) {
  const dimension = String(query.dimension || "ALL").toUpperCase();
  if (!DIMENSION_VALUES.has(dimension)) return invalid("dimension", "dimension is invalid");
  return { valid: true, value: { dimension } };
}

function products({ query }) {
  const pagination = parsePage(query);
  if (pagination.valid === false) return pagination;
  const categoryId = parseOptionalId(query.categoryId, "categoryId");
  if (categoryId && categoryId.valid === false) return categoryId;
  const materialId = parseOptionalId(query.materialId, "materialId");
  if (materialId && materialId.valid === false) return materialId;

  let keyword;
  if (query.keyword != null) {
    keyword = String(query.keyword).trim();
    if (!keyword || keyword.length > 40) return invalid("keyword", "keyword must contain 1 to 40 characters");
  }

  const sort = String(query.sort || "DEFAULT").toUpperCase();
  if (!SORT_VALUES.has(sort)) return invalid("sort", "sort is invalid");
  const inStock = parseBoolean(query.inStock, "inStock");
  if (inStock && inStock.valid === false) return inStock;
  const minPriceAmount = parseAmount(query.minPriceAmount, "minPriceAmount");
  if (minPriceAmount && minPriceAmount.valid === false) return minPriceAmount;
  const maxPriceAmount = parseAmount(query.maxPriceAmount, "maxPriceAmount");
  if (maxPriceAmount && maxPriceAmount.valid === false) return maxPriceAmount;
  if (minPriceAmount !== undefined && maxPriceAmount !== undefined && minPriceAmount > maxPriceAmount) {
    return invalid("minPriceAmount", "minPriceAmount cannot be greater than maxPriceAmount");
  }

  return {
    valid: true,
    value: {
      ...pagination,
      categoryId,
      materialId,
      keyword,
      sort,
      inStock,
      minPriceAmount,
      maxPriceAmount,
    },
  };
}

function productDetail({ params }) {
  const productId = parseId(params.productId, "productId");
  if (productId.valid === false) return productId;
  return { valid: true, value: { productId } };
}

function collectionDetail({ params }) {
  const collectionId = parseId(params.collectionId, "collectionId");
  if (collectionId.valid === false) return collectionId;
  return { valid: true, value: { collectionId } };
}

function articles({ query }) {
  const pagination = parsePage(query);
  if (pagination.valid === false) return pagination;
  let tag;
  if (query.tag != null) {
    tag = String(query.tag).trim();
    if (!tag || tag.length > 40) return invalid("tag", "tag must contain 1 to 40 characters");
  }
  return { valid: true, value: { ...pagination, tag } };
}

function articleDetail({ params }) {
  const articleId = parseId(params.articleId, "articleId");
  if (articleId.valid === false) return articleId;
  return { valid: true, value: { articleId } };
}

module.exports = {
  categories,
  products,
  productDetail,
  collectionDetail,
  articles,
  articleDetail,
};
