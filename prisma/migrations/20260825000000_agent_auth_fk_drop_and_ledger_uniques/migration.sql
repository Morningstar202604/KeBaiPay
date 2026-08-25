-- ============================================================================
-- 1) AgentAuthorization.subject_id 去除外键
--    subjectType 支持 user / merchant 两种主体，但单一外键只能指向 users 表，
--    导致为 merchant 主体创建授权必然违反外键约束。
--    存在性校验移至应用层（AgentAuthService.authorize 已校验主体存在），
--    联合索引 (subject_type, subject_id) 保留，查询性能不受影响。
-- ============================================================================
ALTER TABLE "agent_authorizations" DROP CONSTRAINT IF EXISTS "agent_authorizations_subject_id_fkey";
DROP INDEX IF EXISTS "agent_authorizations_subject_type_subject_id_idx";
CREATE INDEX "agent_authorizations_subject_type_subject_id_idx" ON "agent_authorizations"("subject_type", "subject_id");

-- ============================================================================
-- 2) subscription_charges 同订阅同周期唯一（防重复扣款的 DB 级兜底）
--    先防御性去重：保留每组 (subscription_id, cycle_start) 中 created_at 最新的一条
-- ============================================================================
DELETE FROM "subscription_charges" a
  USING "subscription_charges" b
  WHERE a."subscription_id" = b."subscription_id"
    AND a."cycle_start" = b."cycle_start"
    AND a."created_at" < b."created_at";
DELETE FROM "subscription_charges" a
  USING "subscription_charges" b
  WHERE a."subscription_id" = b."subscription_id"
    AND a."cycle_start" = b."cycle_start"
    AND a."created_at" = b."created_at"
    AND a."id" > b."id";
CREATE UNIQUE INDEX "subscription_charges_subscription_id_cycle_start_key"
  ON "subscription_charges"("subscription_id", "cycle_start");

-- ============================================================================
-- 3) bills 同用户同交易唯一（防重复写账单的 DB 级兜底）
--    先防御性去重：保留每组 (user_id, transaction_id) 中 created_at 最新的一条
-- ============================================================================
DELETE FROM "bills" a
  USING "bills" b
  WHERE a."user_id" = b."user_id"
    AND a."transaction_id" = b."transaction_id"
    AND a."created_at" < b."created_at";
DELETE FROM "bills" a
  USING "bills" b
  WHERE a."user_id" = b."user_id"
    AND a."transaction_id" = b."transaction_id"
    AND a."created_at" = b."created_at"
    AND a."id" > b."id";
CREATE UNIQUE INDEX "bills_user_id_transaction_id_key"
  ON "bills"("user_id", "transaction_id");
