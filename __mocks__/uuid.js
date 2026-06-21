// CJS shim for uuid — used by Jest (uuid 14.x is pure ESM and cannot be
// required directly in Jest's CommonJS transform mode).
// Returns a deterministic counter-based UUID so tests can assert on the value.
let counter = 0;
module.exports = {
  v4: () => `00000000-0000-0000-0000-${String(++counter).padStart(12, '0')}`,
};
