function createMockStorage({ files = new Map() } = {}) {
  return {
    provider: "MOCK",
    files,
    async upload({ cloudPath, buffer }) {
      const fileID = `cloud://mock-env.${cloudPath}`;
      files.set(fileID, Buffer.from(buffer));
      return { fileID, cloudPath };
    },
    async delete({ fileID }) {
      files.delete(fileID);
      return { deleted: true };
    },
    resolveReadUrl(value) { return value; },
  };
}

module.exports = { createMockStorage };
