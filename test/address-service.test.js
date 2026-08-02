const test = require("node:test");
const assert = require("node:assert/strict");

const { mapAddress } = require("../services/address.service");

test("address mapping returns canonical region fields and display region", () => {
  const address = mapAddress({
    id: "1",
    recipient_name: "林清和",
    phone: "13900005678",
    province: "江苏省",
    city: "苏州市",
    district: "姑苏区",
    detail: "平江路 32 号",
    postal_code: null,
    label: "家",
    is_default: 1,
    created_at: "2026-08-02T00:00:00.000Z",
    updated_at: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(address.recipientName, "林清和");
  assert.equal(address.region, "江苏省 苏州市 姑苏区");
  assert.equal(address.isDefault, true);
});
