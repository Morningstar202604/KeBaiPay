-- 渠道类型列废弃：聚合模式纯收单，type 无业务语义（前端/服务端零消费）
ALTER TABLE "payment_channel_configs" DROP COLUMN IF EXISTS "type";
