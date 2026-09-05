-- 订阅连续扣款失败计数器：唯一约束 (subscriptionId, cycleStart) 下失败重试复用同一记录行，
-- 行级历史无法表达"连续失败次数"，改由订阅行维护（成功清零，达到阈值转 SUSPENDED 止损）
ALTER TABLE "subscriptions" ADD COLUMN "consecutive_failures" INTEGER NOT NULL DEFAULT 0;
