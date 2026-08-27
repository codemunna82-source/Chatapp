const expoConfig = require('eslint-config-expo/flat');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig([
  expoConfig,
  {
    // A plain Node build utility (not app code) — Node globals, not
    // React Native's, so it's excluded from the RN-focused lint rules
    // rather than special-cased with overrides.
    ignores: ['dist/*', 'node_modules/*', 'android/*', 'ios/*', 'scripts/*'],
  },
]);
