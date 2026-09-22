/**
 * reflect-metadata polyfill（Jest ESM 测试环境专用）
 *
 * 背景：
 * NestJS 12 全链路 ESM（@nestjs/* 均 type:module），Jest 走原生 ESM 模式
 * （ts-jest default-esm + useESM + --experimental-vm-modules）。
 * NestJS 的 DI 反射依赖 emitDecoratorMetadata 编译出的 __metadata helper，
 * 该 helper 需要 Reflect.metadata（由 reflect-metadata polyfill 注入）。
 *
 * CJS 模式下 Jest 会自动 polyfill；但 ESM 模式下 Jest 的 setupFiles 不会
 * 自动 import 'reflect-metadata'，导致运行时 Reflect.metadata 不存在 →
 * 装饰器 __metadata 是空操作 → NestJS DI 拿不到 design:paramtypes →
 * guard/controller 依赖解析全失败（如 JwtAuthGuard）。
 *
 * reflect-metadata 是 CJS 包（type 非 module），ESM 运行时里由 Jest 的
 * transformIgnorePatterns 放行转译。本文件在每个 test framework 安装前执行
 * （setupFiles），确保测试文件 import 链之前 Reflect.metadata 已就位。
 *
 * 仅在测试环境生效，不影响生产（生产 main.ts 已直接 import 'reflect-metadata'）。
 */
import 'reflect-metadata'
