module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // xrpl@5 depends on ESM-only @noble/@scure packages, which Jest can't require
  // as CommonJS on Node 22; compile them with ts-jest like xrpl.js does.
  transform: {
    'node_modules/(@scure|@noble)/.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true } },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!(@scure|@noble)/)'],
  roots: ['./test/'],
  testRegex: '(/__tests__/.*|\\.(test|spec))\\.[tj]sx?$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverage: true,
  maxWorkers: 1,
  coverageReporters: ['text', 'text-summary', 'html'],
  setupFiles: ['dotenv/config'],
}
