<template>
  <el-card shadow="never">
    <div class="toolbar">
      <el-select
        v-model="query.status"
        placeholder="全部状态"
        clearable
        style="width: 160px"
        @change="onSearch"
      >
        <el-option label="待支付" value="PENDING" />
        <el-option label="已支付" value="PAID" />
        <el-option label="已关闭" value="CLOSED" />
        <el-option label="已退款" value="REFUNDED" />
      </el-select>
      <el-date-picker
        v-model="range"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
        style="width: 280px"
      />
      <el-button type="primary" @click="onSearch">查询</el-button>
      <el-button @click="onReset">重置</el-button>
    </div>

    <el-table :data="orders" v-loading="loading" stripe>
      <el-table-column prop="orderNo" label="订单号" min-width="180" show-overflow-tooltip />
      <el-table-column prop="subject" label="商品名称" min-width="140" show-overflow-tooltip />
      <el-table-column label="金额" width="120">
        <template #default="{ row }">¥ {{ row.amountYuan }}</template>
      </el-table-column>
      <el-table-column label="手续费" width="100">
        <template #default="{ row }">¥ {{ row.feeYuan }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="回调状态" width="130">
        <template #default="{ row }">
          <el-tooltip
            :content="`已重试 ${row.notifyCount} 次${row.callbackUrl ? '' : '（未配置回调地址）'}`"
            placement="top"
          >
            <el-tag :type="row.notifyStatus === 'SUCCESS' ? 'success' : row.notifyStatus === 'FAILED' ? 'danger' : 'warning'">
              {{ row.notifyStatus }}
            </el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" width="180">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="onDetail(row)">详情</el-button>
          <el-popconfirm
            v-if="row.notifyStatus !== 'SUCCESS' && row.callbackUrl"
            title="确认重新发送回调通知？"
            width="220"
            @confirm="onRetry(row)"
          >
            <template #reference>
              <el-button link type="warning">重试回调</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-size="query.limit"
        :current-page="query.page"
        @current-change="onPage"
      />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { OrderStatus, PaymentOrder } from '@/types'
import { fetchOrders, retryOrderNotify } from '@/api/modules'
import { extractError } from '@/api/http'

const loading = ref(false)
const orders = ref<PaymentOrder[]>([])
const total = ref(0)
const range = ref<[string, string] | null>(null)

const query = reactive<{
  status?: OrderStatus
  startDate?: string
  endDate?: string
  page: number
  limit: number
}>({
  status: undefined,
  startDate: undefined,
  endDate: undefined,
  page: 1,
  limit: 15,
})

function statusText(s: string) {
  const map: Record<string, string> = {
    PENDING: '待支付',
    PAID: '已支付',
    CLOSED: '已关闭',
    REFUNDED: '已退款',
  }
  return map[s] || s
}
function statusType(s: string) {
  const map: Record<string, 'info' | 'success' | 'info' | 'warning'> = {
    PENDING: 'warning',
    PAID: 'success',
    CLOSED: 'info',
    REFUNDED: 'info',
  }
  return map[s] || 'info'
}
function formatTime(v: string) {
  return v ? v.replace('T', ' ').slice(0, 19) : '-'
}

async function load() {
  loading.value = true
  try {
    const res = await fetchOrders(query)
    orders.value = res.data
    total.value = res.total
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}

function onSearch() {
  query.startDate = range.value?.[0]
  query.endDate = range.value?.[1]
  query.page = 1
  load()
}
function onReset() {
  query.status = undefined
  query.startDate = undefined
  query.endDate = undefined
  query.page = 1
  range.value = null
  load()
}
function onPage(p: number) {
  query.page = p
  load()
}
function onDetail(row: PaymentOrder) {
  ElMessage.info(`订单号：${row.orderNo}`)
}

async function onRetry(row: PaymentOrder) {
  try {
    await retryOrderNotify(row.orderNo)
    ElMessage.success('回调已重试发送')
    load()
  } catch (e) {
    ElMessage.error(extractError(e))
  }
}

onMounted(load)
</script>

<style scoped>
.toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
