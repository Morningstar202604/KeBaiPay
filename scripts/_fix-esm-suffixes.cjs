// 一次性脚本：为 Jest ESM 模式补全 spec/e2e 文件里相对 import 的 .js 后缀
// Node ESM 严格解析：TS 源 `from './accounts.service'` 转译后须写 `./accounts.service.js`
// 只处理 *.spec.ts / *.e2e-spec.ts；只补「相对路径 + 无后缀」的 from 子句；已带后缀一律不动（幂等）
const fs = require('fs')
const path = require('path')

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (p.endsWith('.spec.ts') || p.endsWith('.e2e-spec.ts')) out.push(p)
  }
  return out
}

const files = [...walk('src'), ...walk('test')].filter(
  (f) => f.endsWith('.spec.ts') || f.endsWith('.e2e-spec.ts'),
)

// 匹配 `from '...'` 与 `import('...')` / `export ... from` 中的相对路径
// 仅当路径以 ./ ../ 开头，且不含 .js/.jsx/.ts/.tsx/.mjs/.cjs 后缀时，补 .js
const re = /(from\s+|import\s*\(\s*)(['"])(\.\.?\/[^'"]+?)(\.(?:js|jsx|ts|tsx|mjs|cjs))?\2/g

let patchedFiles = 0
let patchedImports = 0

for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8')
  const orig = txt
  let m
  let out = ''
  let last = 0
  while ((m = re.exec(txt))) {
    const prefix = m[1]      // "from " 或 "import("
    const q = m[2]          // 引号
    const p = m[3]          // 路径
    const suf = m[4]        // 已有后缀（或 undefined）
    out += txt.slice(last, m.index) + prefix + q + p + (suf || '.js') + q
    last = re.lastIndex
    if (!suf) patchedImports++
  }
  out += txt.slice(last)
  if (out !== orig) {
    fs.writeFileSync(f, out, 'utf8')
    patchedFiles++
  }
}

console.log('patched files:', patchedFiles)
console.log('patched relative imports (no-suffix → .js):', patchedImports)
