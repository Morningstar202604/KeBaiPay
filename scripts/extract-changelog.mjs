#!/usr/bin/env node
/**
 * 从 docs/CHANGELOG.md 提取指定版本的章节正文，供 GitHub Release 使用。
 *
 * 用法：
 *   node scripts/extract-changelog.mjs 0.3.0
 *   CHANGELOG_PATH=docs/CHANGELOG.md node scripts/extract-changelog.mjs 0.3.0
 *
 * 匹配的标题格式：## 版本 X.Y.Z（YYYY-MM-DD）或 ## 版本 X.Y.Z（进行中）
 */

import { readFileSync } from 'node:fs'

const version = process.argv[2]
if (!version) {
  console.error('用法: node scripts/extract-changelog.mjs <version>  例如 0.3.0')
  process.exit(1)
}

const path = process.env.CHANGELOG_PATH || 'docs/CHANGELOG.md'
const content = readFileSync(path, 'utf8')
const lines = content.split(/\r?\n/)

// 标题形如：## 版本 0.3.0（2026-09-14）
const escaped = version.replace(/\./g, '\\.')
const startRe = new RegExp(`^##\\s*版本\\s*${escaped}\\s*[（(]`)

let start = -1
for (let i = 0; i < lines.length; i++) {
  if (startRe.test(lines[i])) {
    start = i
    break
  }
}

if (start === -1) {
  console.error(`未在 ${path} 中找到版本 ${version} 的章节`)
  process.exit(1)
}

// 找到下一个同级 ## 标题作为结束
let end = lines.length
for (let i = start + 1; i < lines.length; i++) {
  if (/^##\s/.test(lines[i])) {
    end = i
    break
  }
}

const body = lines.slice(start + 1, end).join('\n').trim()

if (!body) {
  console.error(`版本 ${version} 的章节正文为空，请先补全 CHANGELOG`)
  process.exit(1)
}

process.stdout.write(body + '\n')
