const database = require("../database");
const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const createCartRepository = require("../repositories/cart.repository");

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function availability(row) {
  if (
    row.product_deleted_at
    || row.sale_status !== "ON_SALE"
    || !Boolean(row.category_enabled)
    || row.category_dimension !== "PRODUCT_CATEGORY"
    || !Boolean(row.material_enabled)
    || (row.material_dimension && row.material_dimension !== "MATERIAL")
  ) return "PRODUCT_OFF_SHELF";
  if (!Boolean(row.variant_enabled)) return "VARIANT_DISABLED";
  const availableQuantity = toNumber(row.available_quantity);
  if (availableQuantity <= 0) return "OUT_OF_STOCK";
  if (toNumber(row.quantity) > availableQuantity) return "INSUFFICIENT_STOCK";
  return null;
}

function mapCart(rows) {
  const items = rows.map((row) => {
    const quantity = toNumber(row.quantity);
    const priceAmount = toNumber(row.price_amount);
    const availableQuantity = toNumber(row.available_quantity);
    const availabilityReason = availability(row);
    const available = availabilityReason === null;
    return {
      id: row.id,
      productId: row.product_id,
      variantId: row.variant_id,
      quantity,
      checked: Boolean(row.checked) && available,
      product: {
        id: row.product_id,
        name: row.product_name,
        subtitle: row.product_subtitle,
        primaryImageUrl: row.primary_image_url || null,
        saleStatus: row.sale_status,
      },
      variant: {
        id: row.variant_id,
        specLabel: row.spec_label === "默认规格" ? "" : row.spec_label,
        priceAmount,
        originalPriceAmount: row.original_price_amount == null ? null : toNumber(row.original_price_amount),
        availableQuantity,
        enabled: Boolean(row.variant_enabled),
      },
      lineAmount: priceAmount * quantity,
      available,
      availabilityReason,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  });
  const selected = items.filter((item) => item.checked && item.available);
  const availableItems = items.filter((item) => item.available);
  return {
    items,
    summary: {
      cartCount: items.reduce((sum, item) => sum + item.quantity, 0),
      selectedCount: selected.reduce((sum, item) => sum + item.quantity, 0),
      selectedAmount: selected.reduce((sum, item) => sum + item.lineAmount, 0),
      allChecked: availableItems.length > 0 && selected.length === availableItems.length,
      currency: "CNY",
    },
  };
}

function reasonFromContext(context, quantity) {
  if (
    context.product_deleted_at
    || context.sale_status !== "ON_SALE"
    || !Boolean(context.category_enabled)
    || context.category_dimension !== "PRODUCT_CATEGORY"
    || !Boolean(context.material_enabled)
    || (context.material_dimension && context.material_dimension !== "MATERIAL")
  ) return "PRODUCT_OFF_SHELF";
  if (!Boolean(context.variant_enabled)) return "VARIANT_DISABLED";
  const availableQuantity = toNumber(context.available_quantity);
  if (availableQuantity <= 0) return "OUT_OF_STOCK";
  if (quantity > availableQuantity) return "INSUFFICIENT_STOCK";
  return null;
}

function assertPurchasable(context, quantity) {
  if (!context) {
    throw new AppError({
      code: ERROR_CODES.PRODUCT_VARIANT_NOT_FOUND,
      message: "Product variant was not found",
      statusCode: 404,
    });
  }
  const reason = reasonFromContext(context, quantity);
  if (!reason) return;
  const exceedsStock = reason === "INSUFFICIENT_STOCK";
  throw new AppError({
    code: exceedsStock ? ERROR_CODES.CART_QUANTITY_EXCEEDS_STOCK : ERROR_CODES.CART_ITEM_UNAVAILABLE,
    message: exceedsStock ? "Requested quantity exceeds available stock" : "Product variant is not available",
    statusCode: 409,
    details: { reason, availableQuantity: toNumber(context.available_quantity) },
  });
}

function createCartService({
  sequelize = database.sequelize,
  repositoryFactory = createCartRepository,
} = {}) {
  const repository = () => repositoryFactory({ sequelize });
  const inTransaction = (work) => sequelize.transaction(
    async (transaction) => work(repositoryFactory({ sequelize, transaction })),
  );

  async function getCart(userId) {
    return mapCart(await repository().findItems(userId));
  }

  async function addItem(userId, input) {
    await inTransaction(async (repo) => {
      const context = await repo.findPurchaseContext(input.productId, input.variantId, true);
      if (!context) assertPurchasable(null, input.quantity);
      const existing = await repo.findItemByVariant(userId, input.productId, input.variantId, true);
      const quantity = toNumber(existing?.quantity) + input.quantity;
      if (quantity > 99) {
        throw new AppError({
          code: ERROR_CODES.CONFLICT,
          message: "Cart item quantity cannot exceed 99",
          statusCode: 409,
        });
      }
      assertPurchasable(context, quantity);
      if (existing) await repo.updateItem(userId, existing.id, { quantity, checked: true });
      else await repo.insertItem(userId, input.productId, input.variantId, quantity);
    });
    return getCart(userId);
  }

  async function updateItem(userId, itemId, patch) {
    await inTransaction(async (repo) => {
      const initial = await repo.findItemById(userId, itemId, false);
      if (!initial) {
        throw new AppError({
          code: ERROR_CODES.CART_ITEM_NOT_FOUND,
          message: "Cart item was not found",
          statusCode: 404,
        });
      }
      const context = await repo.findPurchaseContext(initial.product_id, initial.variant_id, true);
      const item = await repo.findItemById(userId, itemId, true);
      if (!item) {
        throw new AppError({
          code: ERROR_CODES.CART_ITEM_NOT_FOUND,
          message: "Cart item was not found",
          statusCode: 404,
        });
      }
      const quantity = patch.quantity === undefined ? toNumber(item.quantity) : patch.quantity;
      if (patch.quantity !== undefined || patch.checked === true) assertPurchasable(context, quantity);
      await repo.updateItem(userId, itemId, patch);
    });
    return getCart(userId);
  }

  async function removeItem(userId, itemId) {
    await inTransaction((repo) => repo.deleteItem(userId, itemId));
    return getCart(userId);
  }

  async function setSelection(userId, input) {
    if (input.itemIds && input.itemIds.length === 0) return getCart(userId);
    await inTransaction((repo) => repo.updateSelection(userId, input.checked, input.itemIds));
    return getCart(userId);
  }

  return { getCart, addItem, updateItem, removeItem, setSelection };
}

module.exports = { createCartService, mapCart, availability };
