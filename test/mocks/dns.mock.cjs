/**
 * dns CJS-safe mock（双端兼容）
 *
 * 背景：`test/mocks/dns.mock.ts` 是 ESM（extensionsToTreatAsEsm）。pg 等 CJS 包
 * 内部 require('dns') 时经 moduleNameMapper 命中该 ESM 文件，触发
 * "Cannot require() ES Module ... in a cycle"（require(esm) 成环），
 * 导致 30 个测试套件加载失败、覆盖率塌方（2026-10-03 诊断）。
 *
 * 本文件用纯 CJS 导出同一套 jest.fn，CJS 包 require 与 ESM spec
 * namespace import 双向可用（cjs-module-lexer 可静态识别下列命名导出）。
 * 语义与 dns.mock.ts 完全一致，spec 无需改动。
 *
 * 注意：生产代码路径（Nest 运行时）仍使用真实 Node dns，不受影响。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// jest 实例获取：ESM 运行时下 CJS 模块里 require('@jest/globals') 不可靠
// （会触发 "unexpected token" 加载失败），优先用运行时注入的全局 jest，
// 再回退到 require（CJS 测试环境路径）。
const jestRef =
  typeof jest !== 'undefined'
    ? jest
    : require('@jest/globals').jest

// dns.lookup 回调形态：(hostname, options, callback)
// spec 通过 lookup.mockImplementation 控制返回。
const lookup = jestRef.fn()

// promises.lookup：Promise 形态（与 dns.mock.ts 的 promisesLookup 行为一致）
const promisesLookup = jestRef.fn(() =>
  Promise.resolve([{ address: '93.184.216.34', family: 4 }]),
)

const lookupService = jestRef.fn(() =>
  Promise.resolve(['93.184.216.34']),
)

module.exports = {
  lookup,
  lookupService,
  promises: {
    lookup: promisesLookup,
    lookupService,
  },
}

// 供 `import dns from 'dns'` 形态使用（CJS 的 default 即 module.exports，
// 此属性仅为对齐旧 ESM mock 的 default 形状，冗余无害）
module.exports.default = module.exports
