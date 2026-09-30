-- 合规残留清理（2026-09-30）
-- 1) 删除商户表已下线的提现费率列（withdrawRate，随提现业务下线成为 vestigial 列）
-- 2) 删除零生产引用的复式记账分录表 journal_entries（JournalEntry 模型已从 schema 移除）
-- 3) 删除 6 张 schema 已无对应模型、生产代码零引用的孤儿表（消除 migrate diff 漂移）
--    子表先于父表 DROP：channel_statement_items → channel_statements；risk_audit_messages → risk_audit_sessions
-- 已核对：无任何存活表的外键指向以下待删表，DROP 安全。

ALTER TABLE "merchants" DROP COLUMN IF EXISTS "withdraw_rate";

-- 复式记账分录（资金池残留，生产零引用）
DROP TABLE IF EXISTS "journal_entries";

-- 孤儿表：子表先 DROP
DROP TABLE IF EXISTS "channel_statement_items";
DROP TABLE IF EXISTS "risk_audit_messages";

-- 孤儿表：父表
DROP TABLE IF EXISTS "channel_statements";
DROP TABLE IF EXISTS "custom_risk_rules";
DROP TABLE IF EXISTS "risk_audit_sessions";
DROP TABLE IF EXISTS "reconciliation_difference_items";
