// Unit tests live next to the code (src, *.spec.ts); integration tests in test/ run against a real PostgreSQL.
const tsJest = ['ts-jest', { tsconfig: { ...require('./tsconfig.json').compilerOptions, rootDir: '.', sourceMap: false }, isolatedModules: false }];
module.exports = {
  projects: [
    { displayName: 'unit', testEnvironment: 'node', roots: ['<rootDir>/src'], testMatch: ['**/*.spec.ts'], transform: { '^.+\.ts$': tsJest } },
    {
      displayName: 'e2e', testEnvironment: 'node', roots: ['<rootDir>/test'], testMatch: ['**/*.e2e-spec.ts'],
      transform: { '^.+\.ts$': tsJest }, globalSetup: '<rootDir>/test/global-setup.js', globalTeardown: '<rootDir>/test/global-teardown.js',
    },
  ],
};
