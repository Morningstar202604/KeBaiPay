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
    // @nestjs/axios@12 是 ESM-only，jest 无法加载，映射到 CJS mock
    '^@nestjs/axios$': '<rootDir>/test/mocks/nestjs-axios.mock.ts',
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
  // @nestjs/axios 是 ESM-only 包，须放行让 ts-jest 转换（Stripe connector 依赖 HttpService）
  transformIgnorePatterns: ['node_modules/(?!@nestjs/axios)'],
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
  // 覆盖率门禁：防倒退 + 渐进抬升。
  // 2026-09 基线 53.5/47.8/51.8/54.4（曾虚设 80/80/75/70，从未真正生效）。
  // 每补齐一个低覆盖模块（security 0%、agent 2.1%、red-packets 15.8%）
  // 就上调一档，目标一年内到 75/65/70/75。
  coverageThreshold: {
    global: {
      statements: 54,
      branches: 48,
      functions: 52,
      lines: 55,
    },
  },
}
