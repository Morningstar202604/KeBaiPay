/**
 * ioredis ESM-safe mock
 *
 * ioredis 是 CJS 包（type: undefined, dist 为 "use strict"），在 Jest ESM 运行时里
 * jest.mock('ioredis', factory) 不会劫持 default-import 绑定（工厂被忽略），
 * 且 namespace-import 是冻结 ESM 对象无法 spyOn。仿照 @nestjs/axios mock，
 * 通过 jest.config.js / jest-e2e.config.js 的 moduleNameMapper 将 'ioredis'
 * 映射到本文件。
 *
 * 设计：
 *   - 默认导出是 jest.fn()，每次调用 new Redis(url, opts) 返回可配置的 client，
 *     让 RedisService.spec 继续用 MockedRedis.mockImplementation 模式。
 *   - 由于 jest.config.js 的 clearMocks: true，每个测试前 jest.fn() 的
 *     mockImplementation 会被清空，spec 在 createService 内重新 mockImplementation。
 *
 * 注意：生产代码路径（Nest 运行时）仍使用真实 ioredis，不受影响。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { jest } from '@jest/globals'

type ClientShape = Record<string, any>

// 暴露为可变引用，spec 可读取/重置
const mockRedis = jest.fn() as jest.Mock & { lastInstance?: ClientShape }

// 让 `new Redis(url, opts)` 走 mock：jest.fn() 的 new 行为返回 { instance: ret }，
// 但 ioredis 的真实用法是 `new Redis(...)` 后调 `.get/.set` 等方法，因此
// 让 mock 的 mockImplementation 由 spec 决定（默认返回一个能用的 client）。
mockRedis.mockImplementation(() => {
  const noop = jest.fn().mockResolvedValue(undefined)
  return {
    get: noop,
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    del: noop,
    exists: jest.fn().mockResolvedValue(0),
    expire: noop,
    eval: jest.fn().mockResolvedValue(null),
    incr: jest.fn().mockResolvedValue(0),
    decr: jest.fn().mockResolvedValue(0),
    ttl: jest.fn().mockResolvedValue(-2),
    ping: jest.fn().mockResolvedValue('PONG'),
    disconnect: jest.fn(),
    on: jest.fn(),
    multi: jest.fn(),
  } as ClientShape
})

// 重新导出：spec 用 `import Redis from 'ioredis'` 拿到 jest.fn，再
// `Redis as unknown as jest.Mock` 调 mockImplementation —— 与 CJS 时代行为一致。
export default mockRedis

// 也暴露 namespace 形态供需要具名访问的测试（Redis 类本身）。
export const Redis = mockRedis
