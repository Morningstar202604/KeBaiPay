/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // 仅单测：src 下的 *.spec.ts。e2e（test/*.e2e-spec.ts）走 npm run test:e2e，
  // 避免 CI 的 npm test 意外执行需要完整环境的 e2e 套件
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
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
  // 弱机/CI 2 核 runner 下 supertest 控制器用例偶发超过默认 5s 超时（评审实测 5 例失败），
  // 统一放宽到 15s；maxWorkers 上限避免高并发下机器过载放大超时
  testTimeout: 15000,
  maxWorkers: '50%',
  // 覆盖率配置
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/main.ts',
    '!src/**/*.spec.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 80,
      statements: 80,
    },
  },
}
