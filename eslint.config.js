import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier/flat'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.venv/**',
      'models/**',
      'data/generated/**',
    ],
  },

  // Application and test sources: type-aware linting.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.browser,
    },
    plugins: {
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Numerical code reads better with explicit `Number.parseFloat` than with casts;
      // everything else about unsafe member access stays on.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },

  // React component files.
  {
    files: ['src/**/*.tsx'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },

  // Config files run in Node and are not part of the app's type graph.
  {
    files: ['*.config.{js,ts}', 'eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Prettier last: it only turns formatting rules off.
  prettier,
)
