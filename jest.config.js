module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['./test/'],
  testRegex: '(/__tests__/.*|\\.(test|spec))\\.[tj]sx?$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverage: true,
  maxWorkers: 1,
  coverageReporters: ['text', 'text-summary', 'html'],
  setupFiles: ['dotenv/config'],
}
