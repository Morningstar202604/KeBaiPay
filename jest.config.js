/** @type {import('ts-jest').JestConfigWithTsJest} */
// NestJS 12 全链路 ESM（@nestjs/* 均 type:module）+ 本机 Node v22（不支持原生 require(esm)，需 v24.9+）。
// Jest CJS 模式无法加载 @nestjs/* 运行时，故启用 Jest 原生 ESM 模式（ts-jest default-esm preset）：
//   - preset 'ts-jest/presets/default-esm' + extensionsToTreatAsEsm ['.ts'] + ts-jest useESM
//   - 启动须带 --experimental-vm-modules（见 package.json scripts.test）
//   - spec 文件本地互引已补 .js 后缀（ESM 严格解析）；下方 resolver 把 ./x.js 映射回 ./x.ts 源
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  // 仅单测：src 下的 *.spec.ts。e2e（test/*.e2e-spec.ts）走 npm run test:e2e，
  // 避免 CI 的 npm test 意外执行需要完整环境的 e2e 套件
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  // reflect-metadata polyfill：Jest ESM 模式不会自动 import 'reflect-metadata'，
  // 须在每个 test framework 安装前就位，否则 NestJS 装饰器 __metadata 是空操作，
  // DI 反射（design:paramtypes）丢失，guard/controller 依赖解析全失败。
  // 单测无 setup-env 需求，仅加载 polyfill。
  setupFiles: ['<rootDir>/test/setup-reflect-metadata.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  // 本地 .js 互引 → .ts 源（ESM 严格解析 + jest resolver 找不到 .js 指向的 .ts，需映射）
  resolver: '<rootDir>/test/esm-resolver.cjs',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    // @nestjs/axios@12 是 ESM-only，jest 无法加载，映射到 CJS mock
    '^@nestjs/axios$': '<rootDir>/test/mocks/nestjs-axios.mock.ts',
    // @nestjs-modules/mailer 是 CJS 包，其 dist 在 ESM 运行时经 require() 拉取 @nestjs/common
    // （ESM-only）→ "Must use import to load ES Module"。映射到 ESM-safe mock。
    '^@nestjs-modules/mailer$': '<rootDir>/test/mocks/nestjs-mailer.mock.ts',
    // @nestjs/throttler 同为 CJS 包（无 type:module），ESM 运行时 require @nestjs/common 失败。
    '^@nestjs/throttler$': '<rootDir>/test/mocks/nestjs-throttler.mock.ts',
    // ioredis / dns：CJS 包在 Jest ESM 运行时 jest.mock(name, factory) 工厂被忽略
    // （probe 确认工厂不调用），须用 moduleNameMapper 指到本地 mock 才能劫持 default/namespace。
    // 注意：bcrypt【不】映射到 mock——users.service / admin-auth.service spec 依赖真实
    // bcrypt.compare(hash, pwd) 语义（错密码返 false、对密码返 true），mock 一律 true
    // 会破坏"错密码拒绝"用例。bcrypt 是 CJS 包但 Node 能直接 require，Jest 能加载；
    // spec 内 jest.mock('bcrypt', factory) 仍生效（CJS 包不被 ESM 冻结）。
    '^ioredis$': '<rootDir>/test/mocks/ioredis.mock.ts',
    '^dns$': '<rootDir>/test/mocks/dns.mock.ts',
    // bcrypt：CJS 包，静态 `import * as bcrypt` 的 namespace 在 Jest ESM 运行时不可被
    // jest.mock factory 劫持（probe 证实工厂不调用），须映射到本地 mock。
    // mock 采用"默认真实语义 + jest.fn 可覆写"设计（见 bcrypt.mock.ts 注释）：
    //   - 对密码：hashSync('correct-pwd') 产物 compare('correct-pwd',·) 判 true、
    //     错密码判 false → admin-auth.service.spec 静态 import 的登录用例直接满足；
    //   - 全部 jest.fn → auth.service.spec 静态 import 可 mockResolvedValue 覆写；
    //   - users.service.spec 用动态 await import('bcrypt') + 自带 jest.mock 工厂，
    //     命中其工厂而非本 mapper，三套件互不干扰。
    '^bcrypt$': '<rootDir>/test/mocks/bcrypt.mock.ts',
    // common/helpers：本地 TS 源编译为 ESM，命名导出冻结无法 spyOn。
    // 映射"无 .js 后缀"的相对请求（源文件 '../common/helpers' / '../../common/helpers'）
    // 与"带 .js 后缀"的 spec 请求（'../common/helpers.js'）→ 统一走 mock，
    // 让 spec 的 namespace import 拿到可变 mock（jest.fn()）而非冻结 ESM 命名导出。
    // helpers.spec / helpers.boundary.spec 用 './helpers.js'（同目录）→ 不匹配，
    // 走 resolver 落到真实 .ts，保持对真实实现的断言不被 mock 自欺。
    '(\\.\\.\\/)+common\\/helpers$': '<rootDir>/test/mocks/common-helpers.mock.ts',
    '(\\.\\.\\/)+common\\/helpers\\.js$': '<rootDir>/test/mocks/common-helpers.mock.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        // 关闭 ts-jest 逐文件类型诊断（diagnostics:false，仅转译执行）：
        // TS6 + jest30 下 ts-jest 对 @jest/globals 的 jest.fn() 无参调用 +
        // mockResolvedValue 泛型推导稳定产出 "not assignable to never" 假阳性
        // （已证远程 HEAD 冷跑同样复现，与业务改动无关；此前全绿依赖 jest warm cache 掩盖）。
        // 类型检查由独立门禁 npx tsc --noEmit 把关（全项目含 79 个 spec 0 error）。
        // 注意不能用 isolatedModules（会破坏 ESM 输出导致 CJS 执行错误）。
        diagnostics: false,
        tsconfig: {
          module: 'esnext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          esModuleInterop: true,
          skipLibCheck: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          // 全部 spec 均显式 import '@jest/globals'，不引入全局 'jest' 类型以免冲突
          types: ['node'],
        },
      },
    ],
  },
  clearMocks: true,
  // ESM 模式下，node_modules 里 ESM-only（type:module）的传递依赖须放行让 ts-jest 转译为 ESM，
  // 否则 CJS 运行时 require 它们会报 "Must use import to load ES Module"。
  // 117 个 type:module 包集中在少数顶层包：libphonenumber-js（class-validator 依赖）、
  // nodemailer/@nestjs-modules/mailer（邮件）、@modelcontextprotocol/sdk、zod、nanoid、
  // @nestjs/*（全 ESM）、ioredis、@opentelemetry/*、@prisma/*、rxjs 等。
  // 用 (?!<黑名单>) 放行这些顶层 ESM 包，其余 CJS 包仍走默认忽略（避免全量转译拖慢）。
  transformIgnorePatterns: [
    'node_modules/(?!(libphonenumber-js|nodemailer|@nestjs-modules|@modelcontextprotocol|zod|nanoid|@nestjs|ioredis|@opentelemetry|@prisma|@prisma/adapter-pg|class-validator|@nestjs/axios|alipay-sdk|wechatpay-node-v3|tencentcloud-sdk-nodejs-sms|qrcode|helmet|compression|dayjs|dotenv|prom-client|bcrypt|passport|passport-jwt|reflect-metadata|rxjs|@css-inline|mailparser)/)',
  ],
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
