const { createAddressService } = require("../services/address.service");

const service = createAddressService();

async function getAddresses(req, res) {
  return res.success(await service.getAddresses(req.user.id));
}

async function createAddress(req, res) {
  return res.success(await service.createAddress(req.user.id, req.validated), "created", 201);
}

async function updateAddress(req, res) {
  return res.success(await service.updateAddress(
    req.user.id,
    req.validated.addressId,
    req.validated.patch,
  ));
}

async function removeAddress(req, res) {
  return res.success(await service.removeAddress(req.user.id, req.validated.addressId));
}

async function setDefault(req, res) {
  return res.success(await service.setDefault(req.user.id, req.validated.addressId));
}

module.exports = { getAddresses, createAddress, updateAddress, removeAddress, setDefault };
