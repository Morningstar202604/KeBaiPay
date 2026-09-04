/**
 * @nestjs/axios CJS mock
 *
 * @nestjs/axios@12 是 ESM-only 包（type: module），jest（Node 20 require 无法加载 ESM）
 * 无法直接 require。通过 jest.config.js 的 moduleNameMapper 将 '@nestjs/axios'
 * 映射到本文件，测试中即可正常注入 HttpService。
 *
 * 注意：生产代码路径（Nest 运行时）仍使用真实 @nestjs/axios，不受影响。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Global, Module } from '@nestjs/common'

export class HttpService {
  get<T = any>(_url: string, _config?: any) {
    return {
      toPromise: () => Promise.resolve({ data: {} as T, status: 200, statusText: 'OK', headers: {}, config: {} }),
    }
  }

  post<T = any>(_url: string, _body?: any, _config?: any) {
    return {
      toPromise: () => Promise.resolve({ data: {} as T, status: 200, statusText: 'OK', headers: {}, config: {} }),
    }
  }
}

/** HttpModule 仅需可被 Nest 实例化；HttpService 由测试通过 providers 注入可 mock 的实现 */
@Global()
@Module({
  providers: [HttpService],
  exports: [HttpService],
})
export class HttpModule {}