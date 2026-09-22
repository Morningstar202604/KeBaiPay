/**
 * src/common/helpers ESM-safe mock（仅拦截需要 spyOn 的两个外部交互函数）
 *
 * 背景：common/helpers 是本地 TS 源，被 ts-jest useESM 编译为 ESM；ESM 命名导出
 * 是冻结绑定（getter-only），jest.spyOn(module, 'namedExport') 无法重新赋值
 * （报 "Cannot assign to read only property"）。cashier.service.spec 需拦截
 * isCallbackUrlSafe（防真实 DNS）与 postJsonPinned（防真实 HTTP），故将
 * '../common/helpers' 经 moduleNameMapper 映射到本文件。
 *
 * 设计原则（不破坏 helpers.spec 的真实性）：
 *   - 纯函数（yuanToFen/fenToYuan/generate*）委托真实逻辑：本 mock 文件直接
 *     import 真实 helpers 的实现，使 spec 对纯函数的断言（精度/格式）仍走真实代码，
 *     等价于直接测 src/common/helpers.ts，避免 mock 自欺。
 *   - 外部交互函数（isCallbackUrlSafe/postJsonPinned/createFrozenLegLedgerEntry）
 *     以 jest.fn() 暴露为可变命名导出，spec 可 mockResolvedValue / mockImplementation，
 *     等价于 CJS 时代 spyOn 行为。
 *   - cashier.service.ts 导入的是 '../common/helpers'（经 mapper → 本 mock），
 *     helpers.spec.ts 导入的是 './helpers.js'（经 resolver → 真实 .ts，不经 mapper），
 *     二者互不影响。
 *
 * 注意：此 mock 仅在 jest 测试环境经 moduleNameMapper 生效，生产代码路径不受影响。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { jest } from '@jest/globals'
// 委托真实纯函数实现，保证 helpers.spec / cashier.spec 对纯函数断言仍走真实逻辑
import * as realHelpers from '../../src/common/helpers'

// ===== 纯函数：直接 re-export 真实实现（保持 spec 断言真实性）=====
export const yuanToFen = realHelpers.yuanToFen
export const fenToYuan = realHelpers.fenToYuan
export const generateOrderNo = realHelpers.generateOrderNo
export const generatePaymentNo = realHelpers.generatePaymentNo
export const generateQrCode = realHelpers.generateQrCode
export const generateMerchantNo = realHelpers.generateMerchantNo
export const generateAppId = realHelpers.generateAppId
export const generateAppSecret = realHelpers.generateAppSecret
export const safeJsonParse = realHelpers.safeJsonParse
export const escapeHtml = realHelpers.escapeHtml

// ===== 外部交互函数：jest.fn() 可变，spec 可 mockResolvedValue / mockImplementation =====
// 默认安全（放行），spec 按需覆盖
const isCallbackUrlSafe: jest.Mock = jest.fn(async () => ({ safe: true, reason: undefined as string | undefined }))

// postJsonPinned 默认 ok（spec 按需 mockImplementation 捕获签名/body）
const postJsonPinned: jest.Mock = jest.fn(async () => ({ ok: true, status: 200, body: '' }))

// createFrozenLegLedgerEntry 需 prisma 注入，默认委托真实实现（spec 提供 mock prisma）
const createFrozenLegLedgerEntry: jest.Mock = jest.fn(realHelpers.createFrozenLegLedgerEntry as any)

export { isCallbackUrlSafe, postJsonPinned, createFrozenLegLedgerEntry }

export default {
  yuanToFen,
  fenToYuan,
  generateOrderNo,
  generatePaymentNo,
  generateQrCode,
  generateMerchantNo,
  generateAppId,
  generateAppSecret,
  safeJsonParse,
  escapeHtml,
  isCallbackUrlSafe,
  postJsonPinned,
  createFrozenLegLedgerEntry,
}
