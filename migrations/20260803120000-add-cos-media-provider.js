async function up({ queryInterface }) {
  await queryInterface.sequelize.query(`
    ALTER TABLE \`media_assets\`
    MODIFY \`storage_provider\` ENUM('CLOUDBASE','COS','MOCK','LEGACY_EXTERNAL')
    NOT NULL DEFAULT 'LEGACY_EXTERNAL'
  `);
}

module.exports = { up };
