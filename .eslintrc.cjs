module.exports = {
  plugins: ['chai-friendly'],
  overrides: [
    {
      files: ['**/*.spec.{js,mjs,ts,tsx}', 'apps/**/e2e-tauri/**/*.mjs', 'apps/**/tests/**/*.mjs'],
      rules: {
        'no-unused-expressions': 'off',
        'chai-friendly/no-unused-expressions': 'error'
      }
    }
  ]
};