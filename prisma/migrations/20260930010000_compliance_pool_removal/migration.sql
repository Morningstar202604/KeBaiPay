-- 合规聚合模式：删除资金池表 + 收单订单退款字段扩展
-- 依赖 20260930000000_add_payment_order_channel（channel/channel_order_no）

ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "refund_no" TEXT,
ADD COLUMN IF NOT EXISTS "refund_status" TEXT,
ADD COLUMN IF NOT EXISTS "refund_channel_no" TEXT,
ADD COLUMN IF NOT EXISTS "refund_idempotency_key" TEXT,
ADD COLUMN IF NOT EXISTS "refund_pending_amount" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "payment_orders_refund_no_key" ON "payment_orders"("refund_no");

-- 资金池表（下线）——平台不再持有用户资金，删除历史资金表
DROP TABLE IF EXISTS "subscription_charges";
DROP TABLE IF EXISTS "subscriptions";
DROP TABLE IF EXISTS "subscription_plans";
DROP TABLE IF EXISTS "split_items";
DROP TABLE IF EXISTS "split_orders";
DROP TABLE IF EXISTS "referrals";
DROP TABLE IF EXISTS "referral_codes";
DROP TABLE IF EXISTS "batch_transfer_items";
DROP TABLE IF EXISTS "batch_transfers";
DROP TABLE IF EXISTS "escrow_orders";
DROP TABLE IF EXISTS "platform_accounts";
DROP TABLE IF EXISTS "adjustment_approvals";
DROP TABLE IF EXISTS "red_packet_records";
DROP TABLE IF EXISTS "red_packets";
DROP TABLE IF EXISTS "withdrawal_orders";
DROP TABLE IF EXISTS "bills";
DROP TABLE IF EXISTS "transaction_orders";
DROP TABLE IF EXISTS "account_ledgers";
DROP TABLE IF EXISTS "accounts";
DROP TABLE IF EXISTS "bank_cards";
