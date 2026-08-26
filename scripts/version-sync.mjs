#!/usr/bin/env node
/**
 * 版本号同步/校验脚本（docs/VERSIONING.md 的执行工具）
 *
 * 根 package.json 是唯一权威版本源；web/web-h5/web-admin 三前端版本号必须与其一致。
 *
 * 用法：
 *   node scripts/version-sync.mjs          # 同步三前端版本号为根版本
 *   node scripts/version-sync.mjs --check  # 仅校验，不一致时退出码 1（供 CI 使用）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const FRONTENDS = ['web', 'web-h5', 'web-admin']
const checkOnly = process.argv.includes('--check')

const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const rootPkg = readJson(join(root, 'package.json'))
const version = rootPkg.version

if (!SEMVER_RE.test(version)) {
  console.error(`[version-sync] 根 package.json 版本号不符合 SemVer: "${version}"`)
  process.exit(1)
}

let mismatched = false

for (const dir of FRONTENDS) {
  const pkgPath = join(root, dir, 'package.json')
  const pkg = readJson(pkgPath)

  if (pkg.version === version) {
    console.log(`[version-sync] ${dir}/package.json: ${pkg.version} OK`)
    continue
  }

  if (checkOnly) {
    console.error(
      `[version-sync] ${dir}/package.json: ${pkg.version} != 根版本 ${version} MISMATCH`,
    )
    mismatched = true
  } else {
    const before = pkg.version
    pkg.version = version
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`[version-sync] ${dir}/package.json: ${before} -> ${version}`)
  }
}

if (checkOnly && mismatched) {
  console.error('[version-sync] 版本号不一致。本地执行 `npm run version:sync` 对齐后重试。')
  process.exit(1)
}

console.log(`[version-sync] 全部包对齐到 ${version}${checkOnly ? ' (check only)' : ''}`)
