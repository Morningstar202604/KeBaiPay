/** @type {import('ts-jest').JestConfigWithTsJest} */
const path = require('path')
// NestJS 12 全链路 ESM + Node v22 不支持 require(esm)，e2e 与单测统一走 Jest 原生 ESM 模式：
//   preset default-esm + extensionsToTreatAsEsm + ts-jest useESM + resolver 本地互引映射
//   启动须带 --experimental-vm-modules（见 package.json scripts.test:e2e）
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  rootDir: path.resolve(__dirname, '..'),
  // 相对 glob：'<rootDir>/**' 形式的绝对 glob 在 Windows（路径分隔符为 \）下匹配不到任何文件
  testMatch: ['**/*.e2e-spec.ts'],
  // 在所有测试启动前预设完整 mock env，让需要导入 AppModule 的 e2e 测试能通过 validateEnv
  // 顺序说明：
  //  - setup-reflect-metadata.ts：Jest ESM 模式下不会自动 polyfill Reflect.metadata，
  //    须在 test framework 安装前加载，否则 NestJS 装饰器 __metadata 空操作、DI 反射丢失。
  //  - 两个文件同属 setupFiles（在 framework 前执行），reflect-metadata 先于 setup-env
  //    列出，确保 polyfill 先就位；setup-env 仅写 process.env，二者无强依赖但保持
  //    「反射 polyfill 优先」的清晰语义。
  setupFiles: ['<rootDir>/test/setup-reflect-metadata.ts', '<rootDir>/test/setup-env.ts'],
  // 本地 .js 互引 → .ts 源（ESM 严格解析）
  resolver: '<rootDir>/test/esm-resolver.cjs',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // e2e 规格里使用 src/xxx 路径别名导入模块
    '^src/(.*)$': '<rootDir>/src/$1',
    // @nestjs/axios@12 是 ESM-only，jest 无法加载，映射到 CJS mock
    '^@nestjs/axios$': '<rootDir>/test/mocks/nestjs-axios.mock.ts',
    // @nestjs-modules/mailer 是 CJS 包，ESM 运行时 require @nestjs/common（ESM-only）失败，映射到 mock
    '^@nestjs-modules/mailer$': '<rootDir>/test/mocks/nestjs-mailer.mock.ts',
    // @nestjs/throttler 同为 CJS 包（无 type:module），ESM 运行时 require @nestjs/common 失败
    '^@nestjs/throttler$': '<rootDir>/test/mocks/nestjs-throttler.mock.ts',
    // ioredis / bcrypt / dns：CJS 包在 Jest ESM 运行时 jest.mock 工厂被忽略，须 mapper 指到本地 mock
    '^ioredis$': '<rootDir>/test/mocks/ioredis.mock.ts',
    '^bcrypt$': '<rootDir>/test/mocks/bcrypt.mock.ts',
    '^dns$': '<rootDir>/test/mocks/dns.mock.ts',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'esnext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          esModuleInterop: true,
          skipLibCheck: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          types: ['node', 'jest'],
        },
      },
    ],
  },
  clearMocks: true,
  // ESM-only 传递依赖放行（与单测 jest.config.js 一致）
  transformIgnorePatterns: [
    'node_modules/(?!(libphonenumber-js|nodemailer|@nestjs-modules|@modelcontextprotocol|zod|nanoid|@nestjs|ioredis|@opentelemetry|@prisma|@prisma/adapter-pg|class-validator|@nestjs/axios|alipay-sdk|wechatpay-node-v3|tencentcloud-sdk-nodejs-sms|qrcode|helmet|compression|dayjs|dotenv|prom-client|bcrypt|passport|passport-jwt|reflect-metadata|rxjs|@css-inline|mailparser)/)',
  ],
  // e2e 涉及 supertest 控制器，弱机偶发超 5s，放宽到 30s
  testTimeout: 30000,
  maxWorkers: '50%',
}
