/**
 * dns ESM-safe mock
 *
 * Node 内置 'dns' 是 CJS 模块，Jest ESM 运行时下 jest.mock('dns', factory)
 * 不劫持 namespace-import（工厂被忽略），namespace 对象冻结无法 spyOn。
 * 仿 @nestjs/axios / ioredis mock，通过 moduleNameMapper 映射到本文件。
 *
 * 设计：
 *   - lookup/promises.lookup 均为 jest.fn()，spec 可 mockImplementation 自定义
 *     DNS 解析结果，与 CJS 时代 `jest.mock('dns', () => ({ lookup: jest.fn() }))`
 *     行为等价（保留其余真实校验函数由 spec 按需 mock）。
 *   - 提供 promises.lookup 供 `dns.promises.lookup` 形态访问（helpers.isCallbackUrlSafe
 *     使用 `dns.lookup` 回调形态）。
 *
 * 注意：生产代码路径（Nest 运行时）仍使用真实 Node dns，不受影响。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { jest } from '@jest/globals'

const lookup: jest.Mock = jest.fn()

// dns.lookup 回调形态：(hostname, options, callback)
// spec 通过 lookup.mockImplementation 控制返回。
const promisesLookup: jest.Mock = jest.fn(() =>
  Promise.resolve([
    { address: '93.184.216.34', family: 4 },
  ]),
)

const lookupService: jest.Mock = jest.fn(() =>
  Promise.resolve(['93.184.216.34']),
)

export { lookup, lookupService }
export const promises = {
  lookup: promisesLookup,
  lookupService,
}

export default {
  lookup,
  lookupService,
  promises: {
    lookup: promisesLookup,
    lookupService,
  },
}
