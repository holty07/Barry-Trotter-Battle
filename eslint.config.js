// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import globals from "globals";

// Repository boundaries (docs/01-architecture.md):
//   packages/engine   may not import anything except itself
//   packages/content  may import engine (types) and itself
//   packages/protocol may only import itself
//   apps/*            may import all three packages
//   nothing           may import apps/*
const boundaries = [
  {
    target: "./packages/engine/**",
    from: ["./packages/content/**", "./packages/protocol/**", "./apps/**"],
  },
  {
    target: "./packages/protocol/**",
    from: ["./packages/engine/**", "./packages/content/**", "./apps/**"],
  },
  {
    target: "./packages/content/**",
    from: ["./packages/protocol/**", "./apps/**"],
  },
  {
    target: ["./packages/**"],
    from: ["./apps/**"],
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.wrangler/**",
      "**/*.tsbuildinfo",
      "**/worker-configuration.d.ts",
      "content/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: {
      "import-x": importX,
    },
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver()],
    },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: boundaries,
        },
      ],
    },
  },
);
