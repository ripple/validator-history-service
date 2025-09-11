const globals = require('globals')
const eslintConfig = require('@xrplf/eslint-config/base')
const tseslint = require('typescript-eslint')
const jest = require('eslint-plugin-jest')

module.exports = [
  {
    ignores: [
      '**/node_modules/',
      '**/build/',
      'coverage/',
      '**/*.js',
      '*.d.ts',
      'database-config.js',
    ],
  },
  ...eslintConfig,
  {
    languageOptions: {
      sourceType: 'module', // Allow the use of imports / ES modules
      ecmaVersion: 2020,

      // Make ESLint compatible with TypeScript
      parser: tseslint.parser,
      parserOptions: {
        // Enable linting rules with type information from our tsconfig
        tsconfigRootDir: __dirname,
        project: ['./tsconfig.eslint.json'],
        ecmaFeatures: {
          impliedStrict: true, // Enable global strict mode
        },
      },
      globals: {
        ...globals.node,
        ...globals.es2020,
      },
    },

    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/naming-convention': 'off',
      'no-await-in-loop': 'off',
      '@microsoft-tsdoc/tsdoc-param-tag-with-invalid-name': 'off',
      'jsdoc/check-examples': 'off',
      // Allows the use of 'as' for type assertion for websocket messages retrieval.
      '@typescript-eslint/consistent-type-assertions': [
        'warn',
        {
          assertionStyle: 'as',
        },
      ],
      'max-params': ['warn', 4],

      // Removes comments and blank lines from the max-line rules
      'max-lines-per-function': [
        'warn',
        {
          max: 50,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'max-lines': [
        'warn',
        {
          max: 250,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: false,
        },
      ],
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': ['error'],
      '@typescript-eslint/no-extraneous-class': 'off',
      'no-param-reassign': ['error', { props: false }],
      'max-statements': ['warn', 20],
      'no-continue': 'off',
      'import/no-unassigned-import': [
        'warn',
        {
          allow: ['dotenv/config'],
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts', 'test/**/*.js', '*.test.ts', '*.test.js'],
    ...jest.configs['flat/recommended'],
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      // Removed the max for test files and test helper files, since tests usually need to import more things
      'import/max-dependencies': 'off',

      // describe blocks count as a function in Mocha tests, and can be insanely long
      'max-lines-per-function': 'off',

      // Tests can be very long turns off max-line count
      'max-lines': 'off',

      // We have lots of statements in tests
      'max-statements': 'off',

      // Helper test functions don't need docs
      'jsdoc/require-jsdoc': 'off',
    },
  },
  {
    files: ['test/**/*.test.ts'],
    languageOptions: {
      globals: jest.environments.globals.globals,
    },
    rules: {
      // For our Jest test files, the pattern has been to have unnamed functions
      'func-names': 'off',
    },
    settings: {
      'disable/plugins': ['mocha'],
    },
  },
  {
    files: ['.eslintrc.js', 'jest.config.js'],
    rules: {
      // Removed no-commonjs requirement as eslint must be in common js format
      'import/no-commonjs': 'off',

      // Removed this as eslint prevents us from doing this differently
      'import/unambiguous': 'off',
    },
  },
]
