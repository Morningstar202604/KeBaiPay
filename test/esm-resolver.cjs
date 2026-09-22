/**
 * Jest ESM 本地互引解析器（双职责）：
 *
 * 1) 本地 `.js` 互引 → `.ts` 源：NestJS 12 全链路 ESM 下，spec 文件本地 import 须带 .js 后缀，
 *    但 jest resolver 默认找不到 .js 指向的 .ts 源，此 resolver 补上该映射。
 *
 * 2) libphonenumber-js CJS 入口劫持（修复 32 个套件的 "Must use import to load ES Module"）：
 *    该包 package.json `type:module`，class-validator 的 CJS 文件
 *    `require('libphonenumber-js/max')` 经包解析会落到 ESM 的 `metadata.max.json.js`
 *    （浏览器 workaround 文件，含 export 语法），Jest CJS 运行时无法执行 → 报错。
 *    解法：把 libphonenumber-js 的各入口强制指回同包内真正的 `.cjs` 文件
 *    （该包对每个 ESM 入口都提供了一份 CJS 同名变体）。
 */
const path = require('path')
const fs = require('fs')

const DEFAULT_EXT = ['.js', '.ts', '.tsx', '.jsx', '.cjs', '.mjs', '.json', '']

// 入口请求 → 真正的 CJS 文件（相对 node_modules 根）
const CJS_OVERRIDES = {
  'libphonenumber-js': 'libphonenumber-js/index.cjs',
  'libphonenumber-js/max': 'libphonenumber-js/max/index.cjs',
  'libphonenumber-js/min': 'libphonenumber-js/min/index.cjs',
  'libphonenumber-js/core': 'libphonenumber-js/core/index.cjs',
  'libphonenumber-js/mobile': 'libphonenumber-js/mobile/index.cjs',
  'libphonenumber-js/metadata.max': 'libphonenumber-js/metadata.max.json',
  'libphonenumber-js/metadata.min': 'libphonenumber-js/metadata.min.json',
  'libphonenumber-js/metadata.mobile': 'libphonenumber-js/metadata.mobile.json',
  'libphonenumber-js/metadata.full': 'libphonenumber-js/metadata.full.json',
  'libphonenumber-js/metadata.max.json': 'libphonenumber-js/metadata.max.json',
  'libphonenumber-js/metadata.min.json': 'libphonenumber-js/metadata.min.json',
  'libphonenumber-js/metadata.mobile.json': 'libphonenumber-js/metadata.mobile.json',
  'libphonenumber-js/metadata.full.json': 'libphonenumber-js/metadata.full.json',
}

module.exports = function resolver(request, options) {
  const { basedir, ...rest } = options

  const nodeRoot = rest.rootDir || rest.cwd || process.cwd()

  // 1) 本地 .js → 同名 .ts 源（spec 文件内 ./x.js 形互引）
  if (request.endsWith('.js')) {
    const bare = request.slice(0, -3)
    for (const c of [bare + '.ts', bare + '.tsx']) {
      const p = path.isAbsolute(c) ? c : path.resolve(basedir, c)
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return p
      }
    }
  }

  // 2) libphonenumber-js 入口 → 强制指回 CJS 变体（避免落到 ESM 的 *.json.js）
  const override = CJS_OVERRIDES[request]
  if (override) {
    const p = path.join(nodeRoot, 'node_modules', override)
    if (fs.existsSync(p)) {
      return p
    }
  }

  // 2b) 内部相对 require `../metadata.max.json`（及 min/mobile/full）被 jest unrs-resolver
  //     的 exports 劫持到 ESM 的 `metadata.max.json.js`（含 export 语法，CJS 运行时拒执行）。
  //     当 basedir 落在 libphonenumber-js 包内、且 request 是 metadata.*.json 相对路径时，
  //     强制解析回真实的 `.json` 文件（该文件是纯 JSON 数据，无 ESM 语法，可被 CJS 直接读）。
  if (
    basedir &&
    /node_modules[/\\]libphonenumber-js([/\\]|$)/.test(basedir) &&
    /^(\.\.)*[/.]metadata\.(max|min|mobile|full)\.json$/.test(request)
  ) {
    const real = path.resolve(basedir, request)
    if (fs.existsSync(real)) {
      return real
    }
  }

  // 3) 其余走 jest 默认 resolver
  return rest.defaultResolver
    ? rest.defaultResolver(request, { ...rest, basedir, extensions: DEFAULT_EXT })
    : options.defaultResolver(request, options)
}
