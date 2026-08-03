const { createUserProfileService } = require("../services/user-profile.service");

const service = createUserProfileService();

async function uploadAvatar(req, res) {
  return res.success(await service.uploadAvatar(req.file, req.user), "created", 201);
}

async function updateProfile(req, res) {
  return res.success(await service.updateProfile(req.user, req.validated));
}

module.exports = { uploadAvatar, updateProfile };
