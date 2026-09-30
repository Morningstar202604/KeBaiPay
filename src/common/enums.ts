// Prisma-compatible enum constants for SQLite (no native enum support)
// Use these string constants instead of Prisma enum types

export enum AdminRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  FINANCE = 'FINANCE',
  CUSTOMER_SERVICE = 'CUSTOMER_SERVICE',
  RISK_OFFICER = 'RISK_OFFICER',
}

export enum AdminStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  EXPENSE_RESTRICTED = 'EXPENSE_RESTRICTED',
  INCOME_RESTRICTED = 'INCOME_RESTRICTED',
  FROZEN = 'FROZEN',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum RealNameStatus {
  UNVERIFIED = 'UNVERIFIED',
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum MerchantType {
  PERSONAL = 'PERSONAL',
  ENTERPRISE = 'ENTERPRISE',
}

export enum MerchantStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CLOSED = 'CLOSED',
}

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  FROZEN = 'FROZEN',
}

export enum LedgerType {
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
  FEE = 'FEE',
  ADJUSTMENT = 'ADJUSTMENT',
}

export enum Direction {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export enum TransactionType {
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum BillType {
  RECEIPT = 'RECEIPT',
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
}

export enum BillDirection {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export enum QrCodeType {
  PERSONAL = 'PERSONAL',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  MERCHANT = 'MERCHANT',
}

export enum QrCodeStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum AppStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum PaymentOrderStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  CLOSED = 'CLOSED',
  REFUNDED = 'REFUNDED',
}

export enum NotifyStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export enum RiskEventType {
  LARGE_PAYMENT = 'LARGE_PAYMENT',
  FREQUENT_TRANSACTION = 'FREQUENT_TRANSACTION',
  FREQUENT_LOGIN = 'FREQUENT_LOGIN',
  SUSPICIOUS_DEVICE = 'SUSPICIOUS_DEVICE',
  ACCOUNT_FROZEN = 'ACCOUNT_FROZEN',
  STATUS_CHANGED = 'STATUS_CHANGED',
}

export enum ReconciliationStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  SNAPSHOT_MISSING = 'SNAPSHOT_MISSING',
}

// 优惠券类型
export enum CouponType {
  FIXED = 'FIXED',         // 固定金额减免
  PERCENT = 'PERCENT',     // 百分比折扣
}

// 优惠券状态
export enum CouponStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

// 用户优惠券状态
export enum UserCouponStatus {
  AVAILABLE = 'AVAILABLE',
  USED = 'USED',
  EXPIRED = 'EXPIRED',
}

// 消息分类
export enum MessageCategory {
  SYSTEM = 'SYSTEM',           // 系统通知
  TRANSACTION = 'TRANSACTION', // 交易通知
  PROMOTION = 'PROMOTION',     // 营销推广
  RISK = 'RISK',               // 风控通知
}

// 消息优先级
export enum MessagePriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
}

// 消息状态
export enum MessageStatus {
  SENT = 'SENT',       // 已发送
  READ = 'READ',       // 已读
  ARCHIVED = 'ARCHIVED', // 已归档
}

// 推送通道
export enum NotifyChannel {
  IN_APP = 'IN_APP',   // 站内信
  SMS = 'SMS',         // 短信
  EMAIL = 'EMAIL',     // 邮件
}

// 发票类型
export enum InvoiceType {
  NORMAL = 'NORMAL',       // 普通发票
  SPECIAL = 'SPECIAL',     // 专用发票
}

// 发票状态
export enum InvoiceStatus {
  PENDING = 'PENDING',     // 待开具
  ISSUED = 'ISSUED',       // 已开具
  CANCELLED = 'CANCELLED', // 已作废
}

// S5 多平台对账聚合：渠道对账单状态
export enum ChannelStatementStatus {
  PENDING = 'PENDING',     // 待拉取
  FETCHED = 'FETCHED',     // 已拉取
  FAILED = 'FAILED',       // 拉取失败
}

// S5 匹配状态
export enum MatchStatus {
  UNMATCHED = 'UNMATCHED',     // 未匹配
  MATCHED = 'MATCHED',         // 完全匹配
  MISMATCHED = 'MISMATCHED',   // 匹配但有差异（金额/状态不一致）
}

// S5 对账差异类型
export enum ReconciliationDiffType {
  MISSING_IN_CHANNEL = 'MISSING_IN_CHANNEL',     // 平台有，渠道无
  MISSING_IN_PLATFORM = 'MISSING_IN_PLATFORM',   // 渠道有，平台无
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',           // 金额不一致
  STATUS_MISMATCH = 'STATUS_MISMATCH',           // 状态不一致
}

// S5 对账差异处理状态
export enum ReconciliationDiffStatus {
  PENDING = 'PENDING',               // 待处理
  INVESTIGATING = 'INVESTIGATING',   // 调查中
  RESOLVED = 'RESOLVED',             // 已解决
  IGNORED = 'IGNORED',               // 已忽略
}
