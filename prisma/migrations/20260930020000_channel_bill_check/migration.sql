-- 通道账单对账记录表（模拟/官方账单统一存储，按 日期+通道 唯一）
CREATE TABLE "channel_bill_checks" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "bill_source" TEXT NOT NULL DEFAULT 'mock',
    "bill_count" INTEGER NOT NULL DEFAULT 0,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "mismatch_count" INTEGER NOT NULL DEFAULT 0,
    "platform_count" INTEGER NOT NULL DEFAULT 0,
    "total_amount_fen" INTEGER NOT NULL DEFAULT 0,
    "differences" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "channel_bill_checks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "channel_bill_checks_date_channel_key" ON "channel_bill_checks"("date", "channel");
