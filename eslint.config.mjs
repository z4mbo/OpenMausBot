import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Establish lint without folding unrelated legacy UI/compiler migrations into WP2.
  { files: ["app/**", "components/**", "scripts/**"], rules: {
    "react-hooks/set-state-in-effect": "warn", "react-hooks/refs": "warn", "react-hooks/purity": "warn", "react-hooks/globals": "warn",
    "@next/next/no-html-link-for-pages": "warn", "react/no-unescaped-entities": "warn",
  } },
  { files: ["scripts/**"], rules: { "@typescript-eslint/no-explicit-any": "warn" } },
  // Standalone mockups embed a prebuilt React runtime and compile in research/zap-dot.
  // Independent desktop/host packages have their own checks; never traverse vendored or generated bundles.
  globalIgnores([".next/**", "convex/_generated/**", "public/**", "node_modules/**", "apps/desktop/**", "artifacts/**", "**/playwright-report/**", "**/test-results/**"]),
]);
