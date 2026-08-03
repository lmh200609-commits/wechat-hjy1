const crypto = require("node:crypto");
const database = require("../database");
const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const createAdminCatalogRepository = require("../repositories/admin-catalog.repository");
const { writeAudit } = require("./audit.service");

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  return value === true || value === 1 || value === "1";
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) return value;
  try { return JSON.parse(value); } catch (error) { return fallback; }
}

function error(code, message, statusCode, details) {
  throw new AppError({ code, message, statusCode, details });
}

function categoryDto(row) {
  return {
    id: row.id,
    code: row.code,
    dimension: row.dimension,
    name: row.name,
    parentId: row.parent_id || null,
    iconText: row.icon_text || "",
    sortOrder: number(row.sort_order),
    enabled: bool(row.enabled),
    productCount: number(row.product_count),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function variantDto(row) {
  return {
    id: row.id,
    productId: row.product_id,
    skuCode: row.sku_code,
    specLabel: row.spec_label,
    priceAmount: number(row.price_amount),
    originalPriceAmount: row.original_price_amount == null ? null : number(row.original_price_amount),
    onHandQuantity: number(row.on_hand_quantity),
    reservedQuantity: number(row.reserved_quantity),
    availableQuantity: number(row.available_quantity),
    lowStockThreshold: number(row.low_stock_threshold),
    enabled: bool(row.enabled),
    sortOrder: number(row.sort_order),
    version: number(row.version),
  };
}

function productSummaryDto(row) {
  const availableQuantity = number(row.available_quantity);
  const minPriceAmount = number(row.min_price_amount);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    subtitle: row.subtitle,
    category: { id: row.category_id, name: row.category_name },
    material: row.material_id ? { id: row.material_id, name: row.material_name } : null,
    craft: row.craft || "",
    currency: row.currency,
    minPriceAmount,
    maxPriceAmount: number(row.max_price_amount, minPriceAmount),
    onHandQuantity: number(row.on_hand_quantity),
    reservedQuantity: number(row.reserved_quantity),
    availableQuantity,
    stockStatus: availableQuantity <= 0 ? "SOLD_OUT" : "IN_STOCK",
    saleStatus: row.sale_status,
    salesCount: number(row.sales_count),
    primaryImageUrl: row.primary_image_url || null,
    version: number(row.version),
    publishedAt: iso(row.published_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: iso(row.deleted_at),
  };
}

function auditMeta(context, meta) {
  return {
    adminUserId: context.admin.id,
    requestId: meta?.requestId || null,
    ipAddress: meta?.ipAddress || null,
  };
}

function randomCode(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function productPersistedInput(input) {
  const enabled = input.variants.filter((variant) => variant.enabled);
  const prices = enabled.map((variant) => variant.priceAmount);
  const originals = enabled.map((variant) => variant.originalPriceAmount).filter((value) => value != null);
  return {
    name: input.name,
    subtitle: input.subtitle,
    categoryId: input.categoryId,
    materialId: input.materialId,
    craft: input.craft,
    priceAmount: Math.min(...prices),
    originalPriceAmount: originals.length ? Math.min(...originals) : null,
    lowStockThreshold: Math.min(...enabled.map((variant) => variant.lowStockThreshold)),
    tagsJson: JSON.stringify(input.tags),
    attributesJson: JSON.stringify(input.attributes),
    detailSectionsJson: JSON.stringify(input.detailSections),
  };
}

function createAdminCatalogService({
  sequelize = database.sequelize,
  repositoryFactory = createAdminCatalogRepository,
} = {}) {
  const repo = () => repositoryFactory({ sequelize });
  const transaction = (work) => sequelize.transaction(
    async (tx) => work(repositoryFactory({ sequelize, transaction: tx })),
  );

  async function getCategories(filters) {
    return { items: (await repo().findCategories(filters)).map(categoryDto) };
  }

  async function createCategory(input, context, meta) {
    const result = await transaction(async (repository) => {
      const code = randomCode(input.dimension === "MATERIAL" ? "MAT" : "CAT");
      if (await repository.findCategoryByCodeOrName(code, input.dimension, input.name)) {
        error(ERROR_CODES.CONFLICT, "Category name already exists", 409, { field: "name" });
      }
      const sortOrder = await repository.nextCategorySortOrder(input.dimension);
      const id = await repository.insertCategory({ ...input, code, sortOrder });
      const row = await repository.findCategory(id);
      await writeAudit(repository, {
        ...auditMeta(context, meta), module: "categories", action: "CATEGORY_CREATED",
        targetType: "CATEGORY", targetId: id, targetLabel: input.name, after: categoryDto(row),
      });
      return row;
    });
    return categoryDto(result);
  }

  async function updateCategory(input, context, meta) {
    const result = await transaction(async (repository) => {
      const row = await repository.findCategory(input.categoryId, true);
      if (!row) error(ERROR_CODES.CATEGORY_NOT_FOUND, "Category not found", 404);
      const next = {
        name: input.name ?? row.name,
        iconText: Object.hasOwn(input, "iconText") ? input.iconText : row.icon_text,
        enabled: Object.hasOwn(input, "enabled") ? input.enabled : bool(row.enabled),
      };
      const duplicate = await repository.findCategoryByCodeOrName(row.code, row.dimension, next.name, row.id);
      if (duplicate && duplicate.name === next.name) error(ERROR_CODES.CONFLICT, "Category name already exists", 409, { field: "name" });
      await repository.updateCategory(row.id, next);
      const updated = await repository.findCategory(row.id);
      await writeAudit(repository, {
        ...auditMeta(context, meta), module: "categories", action: "CATEGORY_UPDATED",
        targetType: "CATEGORY", targetId: row.id, targetLabel: updated.name,
        before: categoryDto(row), after: categoryDto(updated),
      });
      return updated;
    });
    return categoryDto(result);
  }

  async function deleteCategory(input, context, meta) {
    return transaction(async (repository) => {
      const row = await repository.findCategory(input.categoryId, true);
      if (!row) error(ERROR_CODES.CATEGORY_NOT_FOUND, "Category not found", 404);
      const references = await repository.categoryReferences(row.id);
      if (Object.values(references).some((count) => count > 0)) {
        error(ERROR_CODES.CATEGORY_IN_USE, "Category is still referenced", 409, references);
      }
      await repository.deleteCategory(row.id);
      await writeAudit(repository, {
        ...auditMeta(context, meta), module: "categories", action: "CATEGORY_DELETED",
        targetType: "CATEGORY", targetId: row.id, targetLabel: row.name, before: categoryDto(row),
      });
      return { deleted: true, id: row.id };
    });
  }

  async function reorderCategories(input, context, meta) {
    return transaction(async (repository) => {
      const rows = await repository.findCategoryIdsByDimension(input.dimension, true);
      const currentIds = rows.map((row) => row.id).sort();
      const requestedIds = [...input.categoryIds].sort();
      if (currentIds.length !== requestedIds.length || currentIds.some((id, index) => id !== requestedIds[index])) {
        error(ERROR_CODES.CATEGORY_REORDER_MISMATCH, "categoryIds must contain every category in the dimension exactly once", 409);
      }
      await repository.reorderCategories(input.categoryIds);
      await writeAudit(repository, {
        ...auditMeta(context, meta), module: "categories", action: "CATEGORIES_REORDERED",
        targetType: "CATEGORY_DIMENSION", targetId: input.dimension,
        before: { categoryIds: rows.map((row) => row.id) }, after: { categoryIds: input.categoryIds },
      });
      return { dimension: input.dimension, categoryIds: input.categoryIds };
    });
  }

  async function assertProductRelations(repository, input, requireEnabled = false) {
    const category = await repository.findCategoryForProduct(input.categoryId, "PRODUCT_CATEGORY");
    if (!category || (requireEnabled && !bool(category.enabled))) {
      error(ERROR_CODES.CATEGORY_NOT_FOUND, "Product category is unavailable", 409, { field: "categoryId" });
    }
    let material = null;
    if (input.materialId) {
      material = await repository.findCategoryForProduct(input.materialId, "MATERIAL");
      if (!material || (requireEnabled && !bool(material.enabled))) {
        error(ERROR_CODES.CATEGORY_NOT_FOUND, "Material is unavailable", 409, { field: "materialId" });
      }
    }
    const mediaRows = await repository.findActiveMedia(input.imageMediaIds, true);
    if (mediaRows.length !== input.imageMediaIds.length) {
      error(ERROR_CODES.MEDIA_NOT_FOUND, "One or more product images are unavailable", 409);
    }
    const detailMediaIds = [...new Set(input.detailSections.filter((block) => block.type === "IMAGE").map((block) => block.mediaId))];
    if (detailMediaIds.length && (await repository.findActiveMedia(detailMediaIds, true)).length !== detailMediaIds.length) {
      error(ERROR_CODES.MEDIA_NOT_FOUND, "One or more detail images are unavailable", 409);
    }
    return { category, material };
  }

  async function saveVariants(repository, productId, input, context, existing = []) {
    const existingById = new Map(existing.map((item) => [item.id, item]));
    const retained = new Set();
    for (let index = 0; index < input.variants.length; index += 1) {
      const variant = input.variants[index];
      const skuCode = variant.skuCode || `${input.productCode}-SKU-${String(index + 1).padStart(2, "0")}`;
      const skuOwner = await repository.findVariantBySkuCode(skuCode);
      if (skuOwner && skuOwner.id !== variant.id) {
        error(ERROR_CODES.CONFLICT, "SKU code already exists", 409, { field: `variants[${index}].skuCode` });
      }
      if (variant.id) {
        const current = existingById.get(variant.id);
        if (!current) error(ERROR_CODES.PRODUCT_VARIANT_NOT_FOUND, "Variant does not belong to this product", 409, { variantId: variant.id });
        retained.add(variant.id);
        await repository.updateVariant(variant.id, { ...variant, skuCode });
      } else {
        const variantId = await repository.insertVariant(productId, { ...variant, skuCode });
        if (variant.initialStock > 0) {
          await repository.insertInitialMovement(variantId, variant.initialStock, context.admin.id, "创建商品规格初始库存");
        }
      }
    }
    await repository.disableVariants(existing.filter((item) => !retained.has(item.id)).map((item) => item.id));
  }

  async function getProducts(filters) {
    const result = await repo().findProducts(filters);
    return {
      items: result.rows.map(productSummaryDto), page: filters.page, pageSize: filters.pageSize,
      total: result.total, hasMore: filters.page * filters.pageSize < result.total,
    };
  }

  async function getProduct(productId) {
    const repository = repo();
    const row = await repository.findProduct(productId);
    if (!row) error(ERROR_CODES.PRODUCT_NOT_FOUND, "Product not found", 404);
    const [images, variants] = await Promise.all([
      repository.findProductImages(productId), repository.findProductVariants(productId),
    ]);
    return {
      ...productSummaryDto(row),
      tags: parseJson(row.tags_json, []),
      attributes: parseJson(row.attributes_json, []),
      detailSections: parseJson(row.detail_sections_json, []),
      images: images.map((image) => ({
        id: image.id, mediaId: image.media_id, url: image.url, kind: image.kind,
        altText: image.alt_text || "", sortOrder: number(image.sort_order),
        mediaStatus: image.media_status,
      })),
      variants: variants.map(variantDto),
    };
  }

  async function createProduct(input, context, meta) {
    const productId = await transaction(async (repository) => {
      await assertProductRelations(repository, input, input.publish);
      const code = randomCode("P");
      const persisted = productPersistedInput(input);
      const id = await repository.insertProduct({ ...persisted, code, saleStatus: input.publish ? "ON_SALE" : "DRAFT" });
      await saveVariants(repository, id, { ...input, productCode: code }, context);
      await repository.replaceProductImages(id, input.imageMediaIds, input.primaryMediaId, input.name);
      await repository.refreshReferenceState([
        ...input.imageMediaIds,
        ...input.detailSections.filter((block) => block.type === "IMAGE").map((block) => block.mediaId),
      ]);
      await writeAudit(repository, {
        ...auditMeta(context, meta), module: "products", action: "PRODUCT_CREATED",
        targetType: "PRODUCT", targetId: id, targetLabel: input.name,
        after: { ...input, code },
      });
      if (input.publish) {
        await writeAudit(repository, {
          ...auditMeta(context, meta), module: "products", action: "PRODUCT_PUBLISHED",
          targetType: "PRODUCT", targetId: id, targetLabel: input.name,
          before: { saleStatus: "DRAFT" }, after: { saleStatus: "ON_SALE" },
        });
      }
      return id;
    });
    return getProduct(productId);
  }

  async function updateProduct(input, context, meta) {
    await transaction(async (repository) => {
      const row = await repository.findProduct(input.productId, true);
      if (!row) error(ERROR_CODES.PRODUCT_NOT_FOUND, "Product not found", 404);
      if (number(row.version) !== input.version) {
        error(ERROR_CODES.RESOURCE_VERSION_CONFLICT, "Product was modified by another request", 409, { currentVersion: number(row.version) });
      }
      const shouldBeOnSale = input.publish === undefined ? row.sale_status === "ON_SALE" : input.publish;
      await assertProductRelations(repository, input, shouldBeOnSale);
      const existing = await repository.findProductVariants(row.id, true);
      const existingImages = await repository.findProductImages(row.id);
      const previousDetailMediaIds = parseJson(row.detail_sections_json, [])
        .filter((block) => String(block.type).toUpperCase() === "IMAGE")
        .map((block) => String(block.mediaId));
      const persisted = productPersistedInput(input);
      await saveVariants(repository, row.id, { ...input, productCode: row.code }, context, existing);
      await repository.replaceProductImages(row.id, input.imageMediaIds, input.primaryMediaId, input.name);
      await repository.updateProduct(row.id, persisted);
      const targetStatus = input.publish === undefined ? row.sale_status : (input.publish ? "ON_SALE" : "OFF_SHELF");
      if (row.sale_status !== targetStatus) await repository.setProductSaleStatus(row.id, targetStatus);
      await repository.refreshReferenceState([
        ...existingImages.map((image) => image.media_id),
        ...previousDetailMediaIds,
        ...input.imageMediaIds,
        ...input.detailSections.filter((block) => block.type === "IMAGE").map((block) => block.mediaId),
      ]);
      await writeAudit(repository, {
        ...auditMeta(context, meta), module: "products", action: "PRODUCT_UPDATED",
        targetType: "PRODUCT", targetId: row.id, targetLabel: input.name,
        before: productSummaryDto(row), after: { ...input, version: input.version + (row.sale_status !== targetStatus ? 2 : 1) },
      });
      if (row.sale_status !== targetStatus) {
        await writeAudit(repository, {
          ...auditMeta(context, meta), module: "products",
          action: targetStatus === "ON_SALE" ? "PRODUCT_PUBLISHED" : "PRODUCT_UNPUBLISHED",
          targetType: "PRODUCT", targetId: row.id, targetLabel: input.name,
          before: { saleStatus: row.sale_status }, after: { saleStatus: targetStatus },
        });
      }
    });
    return getProduct(input.productId);
  }

  async function changeProductStatus(productId, saleStatus, context, meta) {
    await transaction(async (repository) => {
      const row = await repository.findProduct(productId, true);
      if (!row || row.sale_status === "DELETED") error(ERROR_CODES.PRODUCT_NOT_FOUND, "Product not found", 404);
      if (saleStatus === "ON_SALE") {
        const [images, variants] = await Promise.all([
          repository.findProductImages(productId), repository.findProductVariants(productId, true),
        ]);
        const category = await repository.findCategoryForProduct(row.category_id, "PRODUCT_CATEGORY");
        const material = row.material_id ? await repository.findCategoryForProduct(row.material_id, "MATERIAL") : null;
        const publishable = images.some((image) => image.kind === "PRIMARY" && image.media_status === "ACTIVE")
          && variants.some((variant) => bool(variant.enabled) && number(variant.price_amount) > 0)
          && category && bool(category.enabled) && (!row.material_id || (material && bool(material.enabled)));
        if (!publishable) error(ERROR_CODES.PRODUCT_NOT_PUBLISHABLE, "Product does not satisfy on-sale requirements", 409);
      }
      await repository.setProductSaleStatus(productId, saleStatus);
      await writeAudit(repository, {
        ...auditMeta(context, meta), module: "products",
        action: saleStatus === "ON_SALE" ? "PRODUCT_PUBLISHED" : "PRODUCT_UNPUBLISHED",
        targetType: "PRODUCT", targetId: row.id, targetLabel: row.name,
        before: { saleStatus: row.sale_status }, after: { saleStatus },
      });
    });
    return getProduct(productId);
  }

  async function deleteProduct(productId, context, meta) {
    return transaction(async (repository) => {
      const row = await repository.findProduct(productId, true);
      if (!row || row.sale_status === "DELETED") error(ERROR_CODES.PRODUCT_NOT_FOUND, "Product not found", 404);
      const images = await repository.findProductImages(productId);
      const detailMediaIds = parseJson(row.detail_sections_json, [])
        .filter((block) => String(block.type).toUpperCase() === "IMAGE")
        .map((block) => String(block.mediaId));
      await repository.softDeleteProduct(productId);
      await repository.refreshReferenceState([...images.map((image) => image.media_id), ...detailMediaIds]);
      await writeAudit(repository, {
        ...auditMeta(context, meta), module: "products", action: "PRODUCT_DELETED",
        targetType: "PRODUCT", targetId: row.id, targetLabel: row.name,
        before: productSummaryDto(row), after: { saleStatus: "DELETED" },
      });
      return { deleted: true, id: row.id };
    });
  }

  async function adjustInventory(input, context, meta) {
    const result = await transaction(async (repository) => {
      const row = await repository.findVariant(input.variantId, true);
      if (!row || row.product_deleted_at) error(ERROR_CODES.PRODUCT_VARIANT_NOT_FOUND, "Product variant not found", 404);
      if (number(row.version) !== input.expectedVersion) {
        error(ERROR_CODES.RESOURCE_VERSION_CONFLICT, "Inventory was modified by another request", 409, { currentVersion: number(row.version) });
      }
      const beforeQuantity = number(row.on_hand_quantity);
      const reservedQuantity = number(row.reserved_quantity);
      const afterQuantity = beforeQuantity + input.changeQuantity;
      if (afterQuantity < reservedQuantity || afterQuantity < 0) {
        error(ERROR_CODES.INVENTORY_ADJUSTMENT_INVALID, "Adjustment would make stock lower than reserved quantity", 409, {
          beforeQuantity, reservedQuantity, afterQuantity,
        });
      }
      await repository.adjustInventory(row.id, {
        changeQuantity: input.changeQuantity,
        beforeQuantity,
        afterQuantity,
        reservedQuantity,
        reasonType: input.reasonType,
        referenceId: meta?.requestId || null,
        note: input.note,
        operatorId: context.admin.id,
      });
      await writeAudit(repository, {
        ...auditMeta(context, meta), module: "inventory", action: "INVENTORY_ADJUSTED",
        targetType: "PRODUCT_VARIANT", targetId: row.id, targetLabel: `${row.product_name} / ${row.spec_label}`,
        before: { onHandQuantity: beforeQuantity, reservedQuantity, version: number(row.version) },
        after: { onHandQuantity: afterQuantity, reservedQuantity, version: number(row.version) + 1, reasonType: input.reasonType, note: input.note },
      });
      return { ...row, on_hand_quantity: String(afterQuantity), available_quantity: String(afterQuantity - reservedQuantity), version: String(number(row.version) + 1) };
    });
    return variantDto(result);
  }

  async function getInventoryMovements(input) {
    const repository = repo();
    const variant = await repository.findVariant(input.variantId);
    if (!variant) error(ERROR_CODES.PRODUCT_VARIANT_NOT_FOUND, "Product variant not found", 404);
    const result = await repository.findInventoryMovements(input.variantId, input);
    return {
      variant: variantDto(variant),
      items: result.rows.map((row) => ({
        id: row.id,
        variantId: row.variant_id,
        changeQuantity: number(row.change_quantity),
        reservedChange: number(row.reserved_change),
        beforeQuantity: number(row.before_quantity),
        afterQuantity: number(row.after_quantity),
        beforeReservedQuantity: number(row.before_reserved_quantity),
        afterReservedQuantity: number(row.after_reserved_quantity),
        reasonType: row.reason_type,
        referenceType: row.reference_type || null,
        referenceId: row.reference_id || null,
        note: row.note || "",
        operator: row.operator_id ? { id: row.operator_id, name: row.operator_name || null } : null,
        createdAt: iso(row.created_at),
      })),
      page: input.page, pageSize: input.pageSize, total: result.total,
      hasMore: input.page * input.pageSize < result.total,
    };
  }

  return {
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    getProducts,
    getProduct,
    createProduct,
    updateProduct,
    changeProductStatus,
    deleteProduct,
    adjustInventory,
    getInventoryMovements,
  };
}

module.exports = {
  createAdminCatalogService,
  categoryDto,
  productSummaryDto,
  variantDto,
};
