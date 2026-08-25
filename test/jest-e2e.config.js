/** @type {import('ts-jest').JestConfigWithTsJest} */
const path = require('path')
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: path.resolve(__dirname, '..'),
  testMatch: ['<rootDir>/**/*.e2e-spec.ts'],
  // 在所有测试启动前预设完整 mock env，让需要导入 AppModule 的 e2e 测试能通过 validateEnv
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  moduleNameMapper: {
    // e2e 规格里使用 src/xxx 路径别名导入模块
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        target: 'ES2021',
        esModuleInterop: true,
        skipLibCheck: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        types: ['node', 'jest'],
      },
    }],
  },
  clearMocks: true,
}
