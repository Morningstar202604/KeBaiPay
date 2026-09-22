/**
 * @nestjs-modules/mailer ESM-safe mock
 *
 * @nestjs-modules/mailer@2.3.7 是 CJS 包（无 type:module），其 dist 在 ESM 运行时
 * 经 require() 拉取 @nestjs/common（ESM-only），而本机 Node v22 不支持 require(esm)，
 * 导致 "Must use import to load ES Module: @nestjs/common/index.js"。
 *
 * 仿照 @nestjs/axios mock（jest.config.js / jest-e2e.config.js 的 moduleNameMapper），
 * 将 '@nestjs-modules/mailer' 映射到本文件。仅暴露测试链路实际用到的两个符号：
 *   - MailerModule（forRootAsync 静态方法，供 NotificationsModule 导入）
 *   - MailerService（构造函数 + sendMail，供 NotificationsService 注入与 mock）
 *
 * 注意：生产代码路径（Nest 运行时）仍使用真实 @nestjs-modules/mailer，不受影响。
 * MailerService.sendMail 默认 no-op，测试可 override 提供 mock 实现。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Global, Module } from '@nestjs/common'

export class MailerService {
  async sendMail(_options: Record<string, any>): Promise<any> {
    // mock：默认不真正发信，测试可 override。
    return { accepted: [], rejected: [], envelope: {} }
  }
}

/**
 * MailerModule 仅需可被 Nest 实例化：为rootAsync 返回 self 以便 forRootAsync 链式可调用。
 * 真实实现由 @nestjs-modules/mailer 提供，此处仅满足 DI 图。
 */
@Global()
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule {
  static forRootAsync(_options: any): any {
    // 测试模块通过 overrideProvider(MailerService) 注入 mock；此处返回 self 以兼容
    // MailerModule.forRootAsync({ ... }) 的链式调用形态。
    return {
      module: MailerModule,
      providers: [MailerService],
      exports: [MailerService],
    }
  }
  static forRoot(_options?: any): any {
    return {
      module: MailerModule,
      providers: [MailerService],
      exports: [MailerService],
    }
  }
}
