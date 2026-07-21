import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/blob-report/**",
      "**/traces/**",
      "**/videos/**",
      "**/screenshots/**",
      "package-lock.json",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["packages/core/**/*.ts", "examples/nopcommerce/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/no-confusing-void-expression": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/prefer-readonly": "error",
    },
  },
  eslintConfigPrettier,
);
