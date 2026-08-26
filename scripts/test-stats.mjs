#!/usr/bin/env node
/**
 * 测试规模统计脚本（docs/VERSIONING.md §4 / P0-9：文档数字自动生成，杜绝手工漂移）
 *
 * 输出：
 *   - 套件数：jest --listTests 实际发现数
 *   - 用例数：对 spec 文件静态统计 it(/test( 出现次数（近似值，以最近一次 CI 实跑为准）
 *
 * 用法：node scripts/test-stats.mjs
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

let suiteCount = 0
try {
  const out = execSync('npx jest --listTests', { cwd: root, encoding: 'utf8' })
  suiteCount = out.split('\n').filter((l) => l.trim().endsWith('.spec.ts')).length
} catch {
  console.error('[test-stats] jest --listTests 执行失败（依赖未安装？）')
  process.exit(1)
}

// 静态统计 src 下 spec 文件中的 it('/test( 用例声明
const rgOut = execSync(
  'rg -o "\\b(it|test)\\(" src --glob "*.spec.ts" --count-matches',
  { cwd: root, encoding: 'utf8' },
)
const caseCount = rgOut
  .split('\n')
  .filter(Boolean)
  .reduce((sum, line) => sum + Number(line.split(':').pop() || 0), 0)

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
console.log(`[test-stats] version=${pkg.version} suites=${suiteCount} cases(~static)=${caseCount}`)
console.log('[test-stats] 用例数为静态近似；权威数字以最近一次 `npm test` / CI 结果为准。')
