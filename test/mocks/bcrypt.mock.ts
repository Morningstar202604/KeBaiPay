/**
 * bcrypt ESM-safe mock（语义正确版）
 *
 * bcrypt 是 CJS 包。Jest ESM 运行时下：
 *   - 静态 `import * as bcrypt from 'bcrypt'`：jest.mock('bcrypt', factory) 工厂【不】生效，
 *     namespace 是真实 CJS 模块，须用 moduleNameMapper 映射到本文件才能劫持。
 *   - 动态 `await import('bcrypt')`：jest.mock 工厂【会】生效（users.service.spec 自带工厂，独立工作）。
 *
 * 设计原则——"默认行为保持真实语义，同时暴露 jest.fn 供 spec 覆写"：
 *   - hashSync(pwd)      → `hashed_${pwd}`（确定性前缀，非真实哈希）
 *   - compare(pwd, hash) → `hash === hashed_${pwd}`（正确密码 true、错误密码 false）
 *   - 全部导出为 jest.fn，spec 可在 beforeEach 内 mockResolvedValue / mockReset 覆写
 *     （auth.service.spec 即用 `(bcrypt.hash as jest.Mock).mockResolvedValue(...)`）。
 *
 * 因此同一 mock 同时满足：
 *   - admin-auth.service.spec（静态 import，依赖"对密码通过、错密码拒绝"的真实语义）
 *   - auth.service.spec（静态 import，调用 mockResolvedValue 覆写默认实现）
 *   - users.service.spec（动态 import + 自带 jest.mock 工厂，与本 mapper 互不干扰）
 *
 * 注意：生产代码路径（Nest 运行时）仍使用真实 bcrypt，不受影响。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { jest } from '@jest/globals'

// 确定性"哈希"前缀：保证 hashSync 的产物能被 compare 以 pwd 正确还原判定。
const hashOf = (pwd: string) => `hashed_${pwd}`

export const hash = jest.fn((pwd: string) => Promise.resolve(hashOf(pwd)))
export const hashSync = jest.fn((pwd: string) => hashOf(pwd))
export const compare = jest.fn((pwd: string, hashVal: string) =>
  Promise.resolve(hashVal === hashOf(pwd)),
)
export const compareSync = jest.fn((pwd: string, hashVal: string) => hashVal === hashOf(pwd))
export const genSalt = jest.fn(() => Promise.resolve('salt'))
export const genSaltSync = jest.fn(() => 'salt-sync')
export const getRounds = jest.fn(() => 10)

export default {
  hash,
  hashSync,
  compare,
  compareSync,
  genSalt,
  genSaltSync,
  getRounds,
}
