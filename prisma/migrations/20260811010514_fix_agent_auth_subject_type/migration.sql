/*
  Warnings:

  - The primary key for the `coupons` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `split_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `split_orders` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `user_coupons` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Made the column `type` on table `coupons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `min_amount` on table `coupons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `total_quota` on table `coupons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `issued_count` on table `coupons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `per_user_limit` on table `coupons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `status` on table `coupons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `coupons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `coupons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `status` on table `split_items` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `split_items` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `split_items` required. This step will fail if there are existing NULL values in that column.
  - Made the column `receiver_count` on table `split_orders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `success_count` on table `split_orders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `failed_count` on table `split_orders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `status` on table `split_orders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `split_orders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `split_orders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `status` on table `user_coupons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `user_coupons` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `user_coupons` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "agent_authorizations" DROP CONSTRAINT "agent_authorizations_subject_id_fkey";

-- DropForeignKey
ALTER TABLE "batch_transfer_items" DROP CONSTRAINT "batch_transfer_items_batch_id_fkey";

-- DropForeignKey
ALTER TABLE "channel_statement_items" DROP CONSTRAINT "channel_statement_items_statement_id_fkey";

-- DropForeignKey
ALTER TABLE "coupons" DROP CONSTRAINT "coupons_owner_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_merchant_id_fkey";

-- DropForeignKey
ALTER TABLE "message_reads" DROP CONSTRAINT "message_reads_user_id_fkey";

-- DropForeignKey
ALTER TABLE "split_items" DROP CONSTRAINT "split_items_receiver_id_fkey";

-- DropForeignKey
ALTER TABLE "split_items" DROP CONSTRAINT "split_items_split_id_fkey";

-- DropForeignKey
ALTER TABLE "split_orders" DROP CONSTRAINT "split_orders_sender_id_fkey";

-- DropForeignKey
ALTER TABLE "user_coupons" DROP CONSTRAINT "user_coupons_coupon_id_fkey";

-- DropForeignKey
ALTER TABLE "user_coupons" DROP CONSTRAINT "user_coupons_user_id_fkey";

-- AlterTable
ALTER TABLE "coupons" DROP CONSTRAINT "coupons_pkey",
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "coupon_no" SET DATA TYPE TEXT,
ALTER COLUMN "owner_id" SET DATA TYPE TEXT,
ALTER COLUMN "name" SET DATA TYPE TEXT,
ALTER COLUMN "type" SET NOT NULL,
ALTER COLUMN "type" SET DATA TYPE TEXT,
ALTER COLUMN "min_amount" SET NOT NULL,
ALTER COLUMN "total_quota" SET NOT NULL,
ALTER COLUMN "issued_count" SET NOT NULL,
ALTER COLUMN "per_user_limit" SET NOT NULL,
ALTER COLUMN "status" SET NOT NULL,
ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ADD CONSTRAINT "coupons_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "split_items" DROP CONSTRAINT "split_items_pkey",
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "split_id" SET DATA TYPE TEXT,
ALTER COLUMN "receiver_id" SET DATA TYPE TEXT,
ALTER COLUMN "status" SET NOT NULL,
ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "transaction_id" SET DATA TYPE TEXT,
ALTER COLUMN "failure_reason" SET DATA TYPE TEXT,
ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ADD CONSTRAINT "split_items_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "split_orders" DROP CONSTRAINT "split_orders_pkey",
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "split_no" SET DATA TYPE TEXT,
ALTER COLUMN "sender_id" SET DATA TYPE TEXT,
ALTER COLUMN "source_order_no" SET DATA TYPE TEXT,
ALTER COLUMN "receiver_count" SET NOT NULL,
ALTER COLUMN "success_count" SET NOT NULL,
ALTER COLUMN "failed_count" SET NOT NULL,
ALTER COLUMN "status" SET NOT NULL,
ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "remark" SET DATA TYPE TEXT,
ALTER COLUMN "idempotency_key" SET DATA TYPE TEXT,
ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "cancelled_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ADD CONSTRAINT "split_orders_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "user_coupons" DROP CONSTRAINT "user_coupons_pkey",
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "user_coupon_no" SET DATA TYPE TEXT,
ALTER COLUMN "coupon_id" SET DATA TYPE TEXT,
ALTER COLUMN "user_id" SET DATA TYPE TEXT,
ALTER COLUMN "status" SET NOT NULL,
ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "used_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "used_order_no" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ADD CONSTRAINT "user_coupons_pkey" PRIMARY KEY ("id");

-- DropEnum
DROP TYPE "AgentScenario";

-- DropEnum
DROP TYPE "AgentStatus";

-- AddForeignKey
ALTER TABLE "channel_statement_items" ADD CONSTRAINT "channel_statement_items_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "channel_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_transfer_items" ADD CONSTRAINT "batch_transfer_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "split_orders" ADD CONSTRAINT "split_orders_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "split_items" ADD CONSTRAINT "split_items_split_id_fkey" FOREIGN KEY ("split_id") REFERENCES "split_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "split_items" ADD CONSTRAINT "split_items_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_coupons" ADD CONSTRAINT "user_coupons_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_coupons" ADD CONSTRAINT "user_coupons_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reads" ADD CONSTRAINT "message_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_authorizations" ADD CONSTRAINT "agent_authorizations_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "idx_coupons_owner" RENAME TO "coupons_owner_id_idx";

-- RenameIndex
ALTER INDEX "idx_coupons_status" RENAME TO "coupons_status_idx";

-- RenameIndex
ALTER INDEX "idx_split_items_receiver" RENAME TO "split_items_receiver_id_idx";

-- RenameIndex
ALTER INDEX "idx_split_items_split" RENAME TO "split_items_split_id_idx";

-- RenameIndex
ALTER INDEX "idx_split_items_status" RENAME TO "split_items_status_idx";

-- RenameIndex
ALTER INDEX "idx_split_orders_created" RENAME TO "split_orders_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_split_orders_sender" RENAME TO "split_orders_sender_id_idx";

-- RenameIndex
ALTER INDEX "idx_split_orders_source" RENAME TO "split_orders_source_order_no_idx";

-- RenameIndex
ALTER INDEX "idx_split_orders_status" RENAME TO "split_orders_status_idx";

-- RenameIndex
ALTER INDEX "idx_user_coupons_coupon" RENAME TO "user_coupons_coupon_id_idx";

-- RenameIndex
ALTER INDEX "idx_user_coupons_status" RENAME TO "user_coupons_status_idx";

-- RenameIndex
ALTER INDEX "idx_user_coupons_user" RENAME TO "user_coupons_user_id_idx";
