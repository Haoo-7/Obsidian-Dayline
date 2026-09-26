import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

/**
 * Mirrors the rule set the Obsidian community-plugin review runs against a
 * submission: the plugin's `recommended` config, which bundles ESLint core,
 * typescript-eslint type-checked rules, and the Obsidian guideline rules.
 *
 * `npm run lint` is the local gate. A clean run means the review's
 * "Source code" section should come back empty.
 */
export default defineConfig([
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'output/**',
      'tablet-variant/**',
      'showcase/**',
      'scripts/**',
      // esbuild output; the review reads `src/`, not the bundle.
      'main.js',
      'libheif-bundle.js',
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.*'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
