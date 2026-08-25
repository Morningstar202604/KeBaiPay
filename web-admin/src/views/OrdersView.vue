<template>
  <el-card shadow="never">
    <div class="toolbar">
      <el-select v-model="status" placeholder="全部状态" clearable style="width: 140px" @change="onSearch">
        <el-option label="待支付" value="PENDING" />
        <el-option label="已支付" value="PAID" />
        <el-option label="已关闭" value="CLOSED" />
        <el-option label="已退款" value="REFUNDED" />
      </el-select>
      <el-button type="primary" @click="onSearch">查询</el-button>
    </div>
    <el-table :data="list" v-loading="loading" stripe>
      <el-table-column prop="orderNo" label="订单号" min-width="180" show-overflow-tooltip />
      <el-table-column prop="merchantOrderNo" label="商户单号" min-width="150" show-overflow-tooltip />
      <el-table-column prop="subject" label="商品" min-width="120" />
      <el-table-column label="金额" width="110">
        <template #default="{ row }">¥{{ row.amountYuan }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'PAID' ? 'success' : 'warning'">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.limit" :current-page="query.page" @current-change="onPage" />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { fmt } from '@/utils/format'
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { PaymentOrder } from '@/types'
import { fetchOrders } from '@/api/modules'
import { extractError } from '@/api/http'

const list = ref<PaymentOrder[]>([])
const total = ref(0)
const loading = ref(true)
const status = ref('')
const query = reactive({ status: '', page: 1, limit: 15 })


async function load() {
  loading.value = true
  try {
    const res = await fetchOrders({ status: query.status, page: query.page, limit: query.limit })
    list.value = res.data
    total.value = res.total
  } catch (e) { ElMessage.error(extractError(e)) } finally { loading.value = false }
}

function onSearch() { query.status = status.value; query.page = 1; load() }
function onPage(p: number) { query.page = p; load() }

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
