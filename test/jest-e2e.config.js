/** @type {import('ts-jest').JestConfigWithTsJest} */
const path = require('path')
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: path.resolve(__dirname, '..'),
  // 相对 glob：'<rootDir>/**' 形式的绝对 glob 在 Windows（路径分隔符为 \）下匹配不到任何文件
  testMatch: ['**/*.e2e-spec.ts'],
  // 在所有测试启动前预设完整 mock env，让需要导入 AppModule 的 e2e 测试能通过 validateEnv
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  moduleNameMapper: {
    // e2e 规格里使用 src/xxx 路径别名导入模块
    '^src/(.*)$': '<rootDir>/src/$1',
    // @nestjs/axios@12 是 ESM-only，jest 无法加载，映射到 CJS mock
    '^@nestjs/axios$': '<rootDir>/test/mocks/nestjs-axios.mock.ts',
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
  // @nestjs/axios 是 ESM-only 包，须放行让 ts-jest 转换（Stripe connector 依赖 HttpService）
  transformIgnorePatterns: ['node_modules/(?!@nestjs/axios)'],
}
