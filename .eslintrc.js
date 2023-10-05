/* eslint-env node */

/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ['eslint:recommended'],
  root: true,
  overrides: [
    {
      files: ['*.ts'],
      extends: ['plugin:@typescript-eslint/recommended'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      rules: {},
    },
    {
      files: ['*.js'],
      parserOptions: {
        ecmaVersion: 'latest',
      },
      env: {
        es6: true,
        node: true,
      },
      rules: {
        "no-unused-vars": "off",
      },
    },
  ],
}
