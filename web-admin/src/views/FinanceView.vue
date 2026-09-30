<template>
  <div>
  <el-card shadow="never">
    <template #header>
      <div class="finance-head">
        <span>财务总览</span>
        <div class="finance-export">
          <el-button size="small" :loading="exporting === 'daily-summary'" @click="exportCsv('daily-summary', '每日汇总')">导出每日汇总 CSV</el-button>
          <el-button size="small" :loading="exporting === 'merchant-settlements'" @click="exportCsv('merchant-settlements', '商户结算')">导出商户结算 CSV</el-button>
        </div>
      </div>
    </template>
    <el-skeleton v-if="loading" :rows="4" animated />
    <el-descriptions v-else :column="2" border>
      <el-descriptions-item v-for="(v, k) in fields" :key="k" :label="k">{{ v }}</el-descriptions-item>
    </el-descriptions>
  </el-card>

  <el-card shadow="never" class="chart-card">
    <template #header>近 7 日收支（元）</template>
    <div class="chart" v-if="chartBars.length">
      <div class="chart-row" v-for="b in chartBars" :key="b.date">
        <span class="chart-date">{{ b.date }}</span>
        <div class="chart-bars">
          <div class="bar income" :style="{ height: b.incomeH + 'px' }" :title="'收入 ¥' + b.income.toFixed(2)"></div>
          <div class="bar expense" :style="{ height: b.expenseH + 'px' }" :title="'支出 ¥' + b.expense.toFixed(2)"></div>
        </div>
      </div>
      <div class="chart-legend">
        <span><i class="dot income"></i>收入</span>
        <span><i class="dot expense"></i>支出</span>
      </div>
    </div>
    <el-empty v-else description="暂无数据" :image-size="60" />
  </el-card>
  <el-card shadow="never" style="margin-top: 16px">
    <template #header>通道账单对账（模拟演练）</template>
    <div class="recon-bar">
      <el-date-picker v-model="reconDate" type="date" value-format="YYYY-MM-DD" placeholder="选择账单日期" size="small" style="width: 160px" />
      <el-select v-model="reconChannel" size="small" style="width: 140px">
        <el-option label="模拟通道 (mock)" value="mock" />
        <el-option label="支付宝 (alipay)" value="alipay" />
        <el-option label="微信 (wechat)" value="wechat" />
      </el-select>
      <el-button size="small" :loading="reconLoading === 'gen'" @click="genBill">生成模拟账单</el-button>
      <el-button size="small" type="primary" :loading="reconLoading === 'run'" @click="runCheck(false)">执行核对</el-button>
      <el-button size="small" type="warning" :loading="reconLoading === 'run2'" @click="runCheck(true)">演练：注入差异</el-button>
      <el-button size="small" type="success" plain @click="importDialog = true">导入官方账单核对</el-button>
    </div>
    <el-alert v-if="mockBill" :title="mockBill.note" type="info" :closable="false" show-icon style="margin: 12px 0">
      <template #default>
        账单笔数 {{ mockBill.billCount }} ｜ 金额合计 ¥{{ (mockBill.totalAmountFen / 100).toFixed(2) }} ｜
        <el-button link type="primary" size="small" @click="billPreview = true">查看账单 CSV</el-button>
      </template>
    </el-alert>
    <template v-if="checkResult">
      <el-descriptions :column="3" border size="small" style="margin-top: 12px">
        <el-descriptions-item label="核对状态">
          <el-tag :type="checkResult.status === 'MATCHED' ? 'success' : 'danger'">{{ checkResult.status }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="账单笔数">{{ checkResult.billCount }}</el-descriptions-item>
        <el-descriptions-item label="平台订单">{{ checkResult.platformCount }}</el-descriptions-item>
        <el-descriptions-item label="匹配笔数">{{ checkResult.matchedCount }}</el-descriptions-item>
        <el-descriptions-item label="差异笔数">{{ checkResult.mismatchCount }}</el-descriptions-item>
        <el-descriptions-item label="账单金额">¥{{ (checkResult.totalAmountFen / 100).toFixed(2) }}</el-descriptions-item>
      </el-descriptions>
      <el-table v-if="checkResult.differences.length" :data="checkResult.differences" size="small" border style="margin-top: 12px" max-height="260">
        <el-table-column prop="type" label="差异类型" width="140" />
        <el-table-column prop="orderNo" label="订单号" min-width="180" />
        <el-table-column label="平台金额(元)" width="110">
          <template #default="{ row }">{{ row.platformAmountFen != null ? (row.platformAmountFen / 100).toFixed(2) : '-' }}</template>
        </el-table-column>
        <el-table-column label="账单金额(元)" width="110">
          <template #default="{ row }">{{ row.billAmountFen != null ? (row.billAmountFen / 100).toFixed(2) : '-' }}</template>
        </el-table-column>
        <el-table-column prop="message" label="说明" min-width="200" />
      </el-table>
    </template>
    <el-empty v-else-if="!reconLoading && !mockBill" description="选择日期后，先生成模拟账单，再执行核对" :image-size="60" style="margin-top: 8px" />
  </el-card>

  <el-dialog v-model="billPreview" title="模拟通道账单（CSV）" width="70%">
    <pre class="bill-csv">{{ mockBill?.bill }}</pre>
  </el-dialog>

  <el-dialog v-model="importDialog" title="导入官方账单核对（微信/支付宝 CSV）" width="72%">
    <div class="recon-bar" style="margin-bottom: 10px">
      <el-date-picker v-model="reconDate" type="date" value-format="YYYY-MM-DD" placeholder="账单日期" size="small" style="width: 160px" />
      <el-select v-model="importChannel" size="small" style="width: 140px">
        <el-option label="支付宝 (alipay)" value="alipay" />
        <el-option label="微信 (wechat)" value="wechat" />
      </el-select>
      <el-button size="small" type="primary" :loading="reconLoading === 'import'" @click="importCheck">解析并核对</el-button>
    </div>
    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 8px"
      title="从微信支付/支付宝商户平台下载当日交易账单（CSV），把内容粘贴到下方，系统将按官方格式解析并与平台订单逐笔核对。解析器已内置微信/支付宝两种格式。" />
    <el-input v-model="importBillText" type="textarea" :rows="10" placeholder="粘贴官方账单 CSV 内容（含表头行）…" />
    <template v-if="checkResult && importChecked">
      <el-descriptions :column="3" border size="small" style="margin-top: 12px">
        <el-descriptions-item label="核对状态"><el-tag :type="checkResult.status === 'MATCHED' ? 'success' : 'danger'">{{ checkResult.status }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="账单笔数">{{ checkResult.billCount }}</el-descriptions-item>
        <el-descriptions-item label="差异笔数">{{ checkResult.mismatchCount }}</el-descriptions-item>
        <el-descriptions-item label="账单来源">{{ checkResult.billSource }}</el-descriptions-item>
        <el-descriptions-item label="解析警告">{{ checkResult.parseWarnings?.length || 0 }} 条</el-descriptions-item>
      </el-descriptions>
      <el-table v-if="checkResult.differences.length" :data="checkResult.differences" size="small" border style="margin-top: 12px" max-height="240">
        <el-table-column prop="type" label="差异类型" width="140" />
        <el-table-column prop="orderNo" label="订单号" min-width="180" />
        <el-table-column label="平台金额(元)" width="110">
          <template #default="{ row }">{{ row.platformAmountFen != null ? (row.platformAmountFen / 100).toFixed(2) : '-' }}</template>
        </el-table-column>
        <el-table-column label="账单金额(元)" width="110">
          <template #default="{ row }">{{ row.billAmountFen != null ? (row.billAmountFen / 100).toFixed(2) : '-' }}</template>
        </el-table-column>
        <el-table-column prop="message" label="说明" min-width="200" />
      </el-table>
      <el-alert v-if="checkResult.parseWarnings?.length" type="warning" :closable="false" style="margin-top: 8px"
        :title="checkResult.parseWarnings.join('；')" />
    </template>
  </el-dialog>

</div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  generateMockChannelBill,
  runChannelReconciliation,
  type MockBillResult,
  type ChannelBillCheckResult,
} from '@/api/modules'
import type { FinanceOverview } from '@/types'
import { fetchFinanceOverview, fetchDailySummary, type DailySummaryItem } from '@/api/modules'
import { extractError } from '@/api/http'
import { TOKEN_KEY } from '@/api/http'

const loading = ref(true)
const chartData = ref<DailySummaryItem[]>([])

// 近 7 日柱图几何：按收入/支出归一化高度（纯 SVG，无图表库依赖）
const chartBars = computed(() => {
  const days = chartData.value
  if (!days.length) return []
  const max = Math.max(...days.map((d) => Math.max(Number(d.totalIncomeYuan), Number(d.totalExpenseYuan)), 1))
  return days.map((d) => {
    const income = Number(d.totalIncomeYuan)
    const expense = Number(d.totalExpenseYuan)
    const scale = (v: number) => Math.max(2, Math.round((v / max) * 90))
    return {
      date: d.date.slice(5),
      incomeH: scale(income),
      expenseH: scale(expense),
      income,
      expense,
    }
  })
})
const data = ref<FinanceOverview | null>(null)
const exporting = ref<'' | 'daily-summary' | 'merchant-settlements'>('')

// CSV 导出：带鉴权头拉取 blob 后触发浏览器下载
async function exportCsv(kind: 'daily-summary' | 'merchant-settlements', filename: string) {
  exporting.value = kind
  try {
    const res = await fetch(`/admin/finance/${kind}/export`, {
      headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) || ''}` },
    })
    if (!res.ok) throw new Error(`导出失败（HTTP ${res.status}）`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename + '.csv'
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导出失败，请稍后重试')
  } finally {
    exporting.value = ''
  }
}

const fields = computed<Record<string, string>>(() => {
  const d = data.value || {}
  return {
    总交易额: `¥${d.totalTurnoverYuan ?? '0.00'}`,
    总收入: `¥${d.totalIncomeYuan ?? '0.00'}`,
    总支出: `¥${d.totalExpenseYuan ?? '0.00'}`,
    手续费: `¥${d.totalFeeYuan ?? '0.00'}`,
    净收入: `¥${d.netIncomeYuan ?? '0.00'}`,
    平台资金池: '已下线（款项由持牌通道直接清算，平台不持有资金）',
    交易笔数: `${d.transactionCount ?? 0}`,
  }
})

onMounted(async () => {
  try {
    const [overview, daily] = await Promise.all([
      fetchFinanceOverview(),
      fetchDailySummary({ startDate: new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10) }),
    ])
    data.value = overview
    chartData.value = (daily.data || []).slice(-7)
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
})
const reconDate = ref(new Date().toISOString().slice(0, 10))
const reconChannel = ref('mock')
const reconLoading = ref('')
const mockBill = ref<MockBillResult | null>(null)
const checkResult = ref<ChannelBillCheckResult | null>(null)
const billPreview = ref(false)
const importDialog = ref(false)
const importChannel = ref('alipay')
const importBillText = ref('')
const importChecked = ref(false)

async function genBill() {
  if (!reconDate.value) return ElMessage.warning('请选择账单日期')
  reconLoading.value = 'gen'
  try {
    mockBill.value = await generateMockChannelBill(reconDate.value, reconChannel.value)
    checkResult.value = null
    ElMessage.success('模拟账单已生成')
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    reconLoading.value = ''
  }
}

async function importCheck() {
  if (!reconDate.value) return ElMessage.warning('请选择账单日期')
  if (!importBillText.value.trim()) return ElMessage.warning('请粘贴官方账单 CSV 内容')
  reconLoading.value = 'import'
  importChecked.value = false
  try {
    checkResult.value = await runChannelReconciliation({
      date: reconDate.value,
      channel: importChannel.value,
      billSource: 'official',
      billText: importBillText.value,
    })
    importChecked.value = true
    ElMessage.success(
      checkResult.value.status === 'MATCHED' ? '官方账单核对通过：平台订单与通道账单完全一致' : '官方账单核对完成：发现差异，详见明细',
    )
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    reconLoading.value = ''
  }
}

async function runCheck(injectDiff: boolean) {
  if (!reconDate.value) return ElMessage.warning('请选择账单日期')
  reconLoading.value = injectDiff ? 'run2' : 'run'
  try {
    checkResult.value = await runChannelReconciliation({
      date: reconDate.value,
      channel: reconChannel.value,
      // 演练模式：注入 1 笔平台漏记 + 1 笔通道多记 + 1 笔金额不一致
      ...(injectDiff
        ? { missingPlatformOrders: 1, extraChannelOrders: 1, amountMismatchOrders: 1 }
        : {}),
    })
    mockBill.value = null
    ElMessage.success(
      checkResult.value.status === 'MATCHED' ? '核对通过：账单与平台完全一致' : '核对完成：发现差异，详见明细',
    )
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    reconLoading.value = ''
  }
}

</script>

<style scoped>
.recon-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.bill-csv {
  max-height: 60vh;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
  background: #f5f7fa;
  padding: 12px;
  border-radius: 4px;
}
.finance-head { display: flex; align-items: center; justify-content: space-between; }
.finance-export { display: flex; gap: 8px; }
.chart-card { margin-top: 16px; }
.chart { display: flex; align-items: flex-end; gap: 18px; overflow-x: auto; padding: 8px 4px 0; }
.chart-row { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 52px; }
.chart-date { font-size: 12px; color: var(--el-text-color-secondary); }
.chart-bars { display: flex; align-items: flex-end; gap: 4px; height: 92px; }
.bar { width: 14px; border-radius: 4px 4px 0 0; }
.bar.income { background: var(--el-color-primary); }
.bar.expense { background: #f59e0b; }
.chart-legend { display: flex; gap: 16px; font-size: 12px; color: var(--el-text-color-secondary); margin-top: 8px; }
.chart-legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; }
.chart-legend .dot.income { background: var(--el-color-primary); }
.chart-legend .dot.expense { background: #f59e0b; }
</style>
