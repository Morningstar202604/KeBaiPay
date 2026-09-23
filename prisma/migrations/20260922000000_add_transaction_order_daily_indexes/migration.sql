-- ============================================================================
-- 风控日计数/日金额统计复合索引（性能报告 P0-1）
--
-- 背景：RiskEngineService.getDailyCount / getDailyAmount 每笔交易各跑一次
--   transactionOrder.count / aggregate，
--   where = { OR: [{fromUserId},{toUserId}], type, createdAt >= 当日, status: 'SUCCESS' }
-- 原有单列索引只能让 OR 的两侧各走一条单列扫描再 UNION，且 createdAt / status
-- 不在任何并列索引上，导致高频用户尾延迟高。
--
-- 方案：为 OR 的两侧各建一条「等值用户 + createdAt 范围 + status 等值」的复合索引，
-- 让 Postgres 对 OR 做 Index Only Scan（或 BitmapOr）后直接按 createdAt 范围裁剪，
-- 无需回表 + 全列过滤。保留原 [fromUserId] / [toUserId] 单列索引不删，
-- 避免其它以单列为首列的查询回归。
--
-- 回滚：两条均为 CREATE INDEX，逆操作即 DROP INDEX，无数据破坏。
-- ============================================================================

CREATE INDEX "transaction_orders_from_user_id_created_at_status_idx"
  ON "transaction_orders"("from_user_id", "created_at", "status");

CREATE INDEX "transaction_orders_to_user_id_created_at_status_idx"
  ON "transaction_orders"("to_user_id", "created_at", "status");
