// 一次性脚本：为 Jest ESM 模式补全 spec/e2e 文件的 @jest/globals 导入
// Node ESM 模式下 jest globals（jest/describe/it/expect/test/...）不再自动注入模块作用域，
// 须显式 `import { ... } from '@jest/globals'`。对每个用到这些 API 且未导入的 spec 文件，
// 在文件顶部首个 import/代码行前插入聚合 import（幂等：已导入则跳过）。
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

const GLOBALS = ['beforeAll', 'beforeEach', 'afterAll', 'afterEach', 'describe', 'expect', 'it', 'test', 'jest']

let patched = 0
let skipped = 0

for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8')
  if (/@jest\/globals/.test(txt)) {
    skipped++
    continue
  }

  // 该文件实际用到的 globals（jest.fn/jest.mock/jest.spyOn 等统一归入 jest）
  const used = []
  for (const g of GLOBALS) {
    if (new RegExp(`\\b${g}\\b`).test(txt)) used.push(g)
  }
  if (used.length === 0) {
    skipped++
    continue
  }

  const importLine = `import { ${used.join(', ')} } from '@jest/globals'\n`

  // 找插入点：文件顶部第一个 import/代码语句行；若全是注释则插到首个代码行前
  const lines = txt.split('\n')
  let insertAt = 0
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i].trimStart()
    if (L.startsWith('import ') || L.startsWith('export ') || L.startsWith('describe(') ||
        L.startsWith('const ') || L.startsWith('let ') || L.startsWith('class ') ||
        L.startsWith('function ') || L.startsWith('module.') || L.startsWith('it(') ||
        L.startsWith('test(') || L.startsWith('expect(')) {
      insertAt = i
      break
    }
  }
  lines.splice(insertAt, 0, importLine.trimEnd())
  fs.writeFileSync(f, lines.join('\n'), 'utf8')
  patched++
}

console.log('patched files:', patched)
console.log('skipped (已导入/无用法):', skipped)
