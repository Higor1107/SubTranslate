import globals from "globals";
import pluginJs from "@eslint/js";

export default [
  {
    languageOptions: { 
      globals: {
        ...globals.browser,
        ...globals.jest,
      } 
    }
  },
  pluginJs.configs.recommended,
  {
    rules: {
      "no-unused-vars": "warn",
      "no-var": "error",
      "prefer-const": "error",
      "eqeqeq": "error",
      "no-console": ["warn", { "allow": ["warn", "error", "log", "debug"] }]
    }
  }
];
