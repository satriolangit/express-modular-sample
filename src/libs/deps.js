// Shared dependency bag — diisi oleh index.js sebelum feature di-require.
// Service/repo melakukan `require('.../deps')` untuk akses db/logger/config.
module.exports = {
  db: null,
  logger: null,
  config: null,
};
