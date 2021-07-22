module.exports = {
  root: true,

  // Make ESLint compatible with TypeScript
  parser: '@typescript-eslint/parser',
  parserOptions: {
    // Enable linting rules with type information from our tsconfig
    tsconfigRootDir: __dirname,
    project: ['./tsconfig.eslint.json'],

    // Allow the use of imports / ES modules
    sourceType: 'module',

    ecmaFeatures: {
      // Enable global strict mode
      impliedStrict: true,
    },
  },

  ignorePatterns: [
    // Ignoring node_modules since generated code doesn't conform to our linting standards
    'node_modules',
    // Ignore build since generated code doesn't conform to our linting standards
    'build',
    // Eslint doesn't lint typing files well so we will just ignore them
    '*.d.ts',
    // Database-config is a common-js file that is required by sequelize cli and doesn't conform to our more cultured ways
    'database-config.js',
  ],

  // Specify global variables that are predefined
  env: {
    // Enable node global variables & Node.js scoping
    node: true,
    // Add all ECMAScript 2020 globals and automatically set the ecmaVersion parser option to ES2020
    es2020: true,
  },

  plugins: ['jest', 'disable'],
  processor: 'disable/disable',
  extends: ['@xpring-eng/eslint-config-base/loose', 'plugin:jest/recommended'],
  rules: {
    '@typescript-eslint/no-magic-numbers': 'off',
    '@typescript-eslint/naming-convention': 'off',
    'no-await-in-loop': 'off',
    '@microsoft-tsdoc/tsdoc-param-tag-with-invalid-name': 'off',
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
  overrides: [
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
      },
    },
    {
      files: ['test/**/*.test.ts'],
      env: {
        // Global variables for jest
        jest: true,
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
  ],
}
