-- 合规聚合模式（资金不过平台）：收单订单增加支付渠道字段
-- 用于渠道支付路径：发起支付时记录 channel / channelOrderNo，
-- 回调确认时校验渠道一致并补录渠道单号
ALTER TABLE "payment_orders" ADD COLUMN "channel" TEXT;
ALTER TABLE "payment_orders" ADD COLUMN "channel_order_no" TEXT;
