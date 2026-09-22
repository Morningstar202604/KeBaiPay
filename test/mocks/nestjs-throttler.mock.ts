/**
 * @nestjs/throttler ESM-safe mock
 *
 * @nestjs/throttler@6.7 是 CJS 包（无 type:module），其 dist 在 ESM 运行时经
 * require() 拉取 @nestjs/common（ESM-only）→ "Must use import to load ES Module"。
 *
 * 仿照 @nestjs/axios 与 @nestjs-modules/mailer mock，将 '@nestjs/throttler'
 * 映射到本文件。仅暴露测试链路用到的符号：
 *   - Throttle / SkipThrottle：装饰器桩（no-op），测试中仅验证控制器实例化与请求路径，
 *     不真正验证限流行为（限流守卫未在本 spec 图中注册）
 *   - ThrottlerModule：forRoot 静态方法桩，供 AppModule 图完整性
 *   - ThrottlerGuard：可实例化占位（供 useClass 注册），但测试 spec 不挂载全局限流
 *
 * 注意：生产代码路径（Nest 运行时）仍使用真实 @nestjs/throttler，不受影响。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Global, Module } from '@nestjs/common'

export function Throttle(_options: Record<string, any>): any {
  return (target: any, _key?: string, _desc?: any) => {
    // no-op：仅保留原方法，测试 spec 中不验证限流
    return target
  }
}

export function SkipThrottle(): any {
  return (target: any, _key?: string, _desc?: any) => {
    // no-op：保留原方法，探针端点不受限流
    return target
  }
}

export class ThrottlerGuard {
  // 占位守卫，测试图不会真正注册到 app.useGlobalGuards；
  // 若被实例化，canActivate 直接放行。
  canActivate(_context: any) {
    return true
  }
}

@Global()
@Module({
  providers: [ThrottlerGuard],
  exports: [ThrottlerGuard],
})
export class ThrottlerModule {
  static forRoot(_options: any): any {
    return {
      module: ThrottlerModule,
      providers: [ThrottlerGuard],
      exports: [ThrottlerGuard],
    }
  }
}
