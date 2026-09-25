#!/usr/bin/env bash
# ==============================================================================
# KeBaiPay 推前全量预检（与 .github/workflows/ci.yml 的六 job 门禁一一对应）
#
# 用法：
#   bash scripts/verify-all.sh          # 完整预检（推荐，推任何平台前必跑）
#   bash scripts/verify-all.sh --fast   # 跳过 e2e 与 coverage（快速冒烟）
#
# 本脚本强制清空 jest 缓存，模拟 CI 冷跑环境——避免"本地绿、CI 红"。
# 任何一步失败立即退出（exit 1），全部通过输出汇总。
# ==============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

# e2e / 迁移冒烟所需环境变量（与 ci.yml 一致；缺省值仅用于本地验证，非生产密钥）
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/test?schema=public}"
export NODE_ENV="${NODE_ENV:-test}"
export JWT_USER_SECRET="${JWT_USER_SECRET:-unit-test-jwt-user-secret}"
export JWT_ADMIN_SECRET="${JWT_ADMIN_SECRET:-unit-test-jwt-admin-secret}"
export JWT_AGENT_SECRET="${JWT_AGENT_SECRET:-unit-test-jwt-agent-secret}"
export ADMIN_DEFAULT_PASSWORD="${ADMIN_DEFAULT_PASSWORD:-Admin@123456}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-unit-test-encryption-key-0123456789abcdef}"
export MOCK_CHANNEL_SECRET="${MOCK_CHANNEL_SECRET:-mock-channel-secret}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

cd "$ROOT" || exit 1

step() { echo ""; echo "──────────────────────────────────────────────────────────"; echo "▶ $1"; echo "──────────────────────────────────────────────────────────"; }
fail() { echo "✗ FAIL: $1"; exit 1; }

echo "KeBaiPay 全量预检（冷跑） — $(date '+%F %T')"
echo "工作目录: $ROOT"

# 0. 清 jest 缓存（模拟 CI 全新环境）
step "0/7 清理 jest 缓存"
node --experimental-vm-modules node_modules/jest/bin/jest.js --clearCache >/dev/null 2>&1 || true
echo "  cache cleared"

# 1. 类型检查（对应 CI test job: tsc --noEmit）
step "1/7 TypeScript 类型检查 (tsc --noEmit)"
npx tsc --noEmit -p tsconfig.json || fail "tsc --noEmit 有错误"

# 2. 版本一致性（对应 CI test job: version:check）
step "2/7 版本一致性检查 (version:check)"
npm run version:check >/dev/null 2>&1 || fail "version:check 失败（根/三端版本或 lockfile 不一致）"

if [[ "$FAST" == "0" ]]; then
  # 3. 单元测试（对应 CI test job: npm test）
  step "3/7 单元测试 (npm test)"
  npm test >/dev/null 2>&1 || fail "单测未全绿（npm test）"
  echo "  单测通过"

  # 4. 覆盖率门禁（对应 CI coverage job: test:cov，阈值在 jest.config.js）
  step "4/7 覆盖率门禁 (npm run test:cov)"
  npm run test:cov >/dev/null 2>&1 || fail "覆盖率未达标（npm run test:cov）"
  echo "  覆盖率达标"

  # 5. e2e（对应 CI e2e job: test:e2e）
  step "5/7 端到端测试 (npm run test:e2e)"
  npm run test:e2e -- --passWithNoTests >/dev/null 2>&1 || fail "e2e 未全绿（npm run test:e2e）"
  echo "  e2e 通过"
else
  echo "（--fast：跳过单测/覆盖率/e2e，仅类型+版本+构建）"
fi

# 6. 三端前端构建（对应 CI web/web-h5/web-admin 三个 job）
for app in web web-h5 web-admin; do
  step "6/7 前端构建 $app"
  (cd "$ROOT/$app" && npm run build >/dev/null 2>&1) || fail "$app 构建失败"
  echo "  $app build 通过"
done

# 7. 外部服务配置自检（对应 CONTRIBUTING 要求；非门禁）
step "7/7 外部服务配置自检 (check:external)"
npm run check:external >/dev/null 2>&1 && echo "  外部服务配置完整（或无需配置）" || echo "  ⚠ check:external 有未配置项（提示类，非门禁）"

echo ""
echo "══════════════════════════════════════════════════════════"
echo " ✅ 全量预检通过 — 可以推送四个平台（gitcode/gitee/github-x33834/github-morningstar）"
echo "══════════════════════════════════════════════════════════"
