import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import * as bcrypt from 'bcrypt'
import { createCipheriv, randomBytes, scryptSync, createHash } from 'crypto'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL 未配置，无法运行 seed')
  process.exit(1)
}

const adapter = new PrismaPg(databaseUrl)
const prisma = new PrismaClient({ adapter })

/**
 * 复用 CryptoService 的加密逻辑：AES-256-GCM，base64(iv:ciphertext:authTag)。
 * seed 脱离 NestJS DI 容器独立运行，因此这里手动复刻一套同样的加密实现，
 * 保证 seed 写入的 idCard 与 verifyIdentity 写入的格式一致（可被 decrypt 解开）。
 */
const SALT = 'kebaipay-salt-v1'
const IV_LENGTH = 12

function getEncryptionKey(): Buffer {
  const encryptionKey = process.env.ENCRYPTION_KEY
  if (!encryptionKey || encryptionKey.length < 32) {
    throw new Error(
      'ENCRYPTION_KEY 未配置或长度不足 32 字符，拒绝 seed。请在 .env 中设置 32 字符以上的随机字符串。',
    )
  }
  return scryptSync(encryptionKey, SALT, 32)
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, ciphertext, authTag]).toString('base64')
}

/** 计算明文 SHA-256 哈希，用于 idCardHash 唯一约束 */
function sha256Hex(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

/** 判断 idCard 是否已是加密格式：加密后 base64 长度至少 40+，明文身份证 18 位 */
function isEncrypted(idCard: string): boolean {
  if (!idCard) return false
  // 明文身份证长度固定 15 或 18 位；加密后 base64 长度必然 > 40
  return idCard.length > 40
}

async function main() {
  console.log('开始 seed...')

  const encryptionKey = getEncryptionKey()

  // 1. 管理员账户（如果不存在）
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@2026'
  const adminCount = await prisma.adminUser.count()
  if (adminCount === 0) {
    await prisma.adminUser.create({
      data: {
        username: 'admin',
        password: await bcrypt.hash(adminPassword, 10),
        role: 'SUPER_ADMIN',
      },
    })
    console.log(`  管理员账户已创建: admin / 密码来自 ADMIN_DEFAULT_PASSWORD`)
  }

  // 2. 测试用户（upsert 确保密码正确）
  const testPhone = '13800000001'
  const testIdCardPlain = '110101199001011234'
  const existingUser = await prisma.user.findUnique({ where: { phone: testPhone } })
  if (!existingUser) {
    const user = await prisma.user.create({
      data: {
        nickname: '测试用户',
        phone: testPhone,
        email: 't***@************',
        loginPassword: await bcrypt.hash('Abc12345', 10),
        payPassword: await bcrypt.hash('123456', 10),
        status: 'ACTIVE',
        realNameStatus: 'VERIFIED',
      },
    })
    await prisma.user.update({
      where: { id: user.id },
      data: { email: 'test@kebaipay.com' },
    })

    // 3. 测试用户实名认证（idCard 必须加密入库 + 写入 idCardHash，
    //    否则 resetPayPassword 调用 crypto.decrypt 会抛错；唯一约束也会被绕过）
    await prisma.identityVerification.create({
      data: {
        userId: user.id,
        realName: '测试用户',
        idCard: encrypt(testIdCardPlain, encryptionKey),
        idCardHash: sha256Hex(testIdCardPlain),
        status: 'VERIFIED',
      },
    })

    console.log(`  测试用户已创建: ${testPhone} / Abc12345`)
  } else {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        loginPassword: await bcrypt.hash('Abc12345', 10),
        payPassword: await bcrypt.hash('123456', 10),
      },
    })

    // 修复历史数据：旧版 seed 把 idCard 以明文写入，导致 resetPayPassword 调用
    // crypto.decrypt 时崩溃，且 idCardHash 为 NULL 绕过唯一约束。这里幂等地修复。
    const identity = await prisma.identityVerification.findUnique({
      where: { userId: existingUser.id },
    })
    if (identity && !isEncrypted(identity.idCard)) {
      await prisma.identityVerification.update({
        where: { userId: existingUser.id },
        data: {
          idCard: encrypt(testIdCardPlain, encryptionKey),
          idCardHash: sha256Hex(testIdCardPlain),
        },
      })
      console.log(`  测试用户历史 idCard 已修复为加密格式`)
    }

    console.log(`  测试用户密码已重置: ${testPhone} / Abc12345`)
  }

  // 4. 测试商户 + 商户应用 + 收单订单样本（幂等）
  //    合规收单模式：平台不持有任何资金，商户仅登记自有结算账户（settleAccount），
  //    不再为用户/商户建任何余额或资金账户；以下为开发联调用的收单订单维度样本。
  const testUser = await prisma.user.findUnique({ where: { phone: testPhone } })
  if (!testUser) {
    throw new Error('测试用户未创建，终止 seed')
  }

  let merchant = await prisma.merchant.findUnique({ where: { userId: testUser.id } })
  if (!merchant) {
    merchant = await prisma.merchant.create({
      data: {
        userId: testUser.id,
        merchantNo: 'M20260930000001',
        merchantName: '测试商户',
        merchantType: 'PERSONAL',
        settleAccount: '622202020011223344',
        status: 'APPROVED',
        reviewedBy: 'SEED',
        reviewedAt: new Date(),
      },
    })
    console.log(`  测试商户已创建: ${merchant.merchantNo} (status=APPROVED)`)
  }

  const seedAppId = 'app_seed_demo'
  const merchantApp = await prisma.merchantApp.findUnique({ where: { appId: seedAppId } })
  if (!merchantApp) {
    await prisma.merchantApp.create({
      data: {
        merchantId: merchant.id,
        appId: seedAppId,
        appSecret: createHash('sha256').update('seed-app-secret-demo').digest('hex'),
        name: '测试应用',
        status: 'ACTIVE',
      },
    })
    console.log(`  测试商户应用已创建: ${seedAppId}`)
  }

  // 收单订单样本：一笔已支付、一笔待支付，供列表/对账联调
  const sampleOrders = [
    { orderNo: 'P20260930000001', merchantOrderNo: 'MO-SEED-001', amount: 10000, subject: '测试商品A', status: 'PAID' as const, paidAt: new Date() },
    { orderNo: 'P20260930000002', merchantOrderNo: 'MO-SEED-002', amount: 5000, subject: '测试商品B', status: 'PENDING' as const, paidAt: null },
  ]
  for (const o of sampleOrders) {
    await prisma.paymentOrder.upsert({
      where: { orderNo: o.orderNo },
      update: {},
      create: {
        orderNo: o.orderNo,
        merchantId: merchant.id,
        merchantOrderNo: o.merchantOrderNo,
        amount: o.amount,
        subject: o.subject,
        status: o.status,
        channel: 'mock',
        paidAt: o.paidAt,
      },
    })
  }
  console.log(`  收单订单样本已就绪: ${sampleOrders.length} 笔`)

  // 5. Mock 支付渠道配置（幂等）：保证新环境开箱即用可发起收单
  const mockChannel = await prisma.paymentChannelConfig.upsert({
    where: { code: 'mock' },
    update: {
      name: 'MockChannel',
      enabled: true,
      priority: 1,
      config: JSON.stringify({
        mockSecret: process.env.MOCK_CHANNEL_SECRET || 'mock-channel-secret-dev-only',
      }),
    },
    create: {
      code: 'mock',
      name: 'MockChannel',
      enabled: true,
      priority: 1,
      config: JSON.stringify({
        mockSecret: process.env.MOCK_CHANNEL_SECRET || 'mock-channel-secret-dev-only',
      }),
    },
  })
  console.log(`  Mock 支付渠道配置已就绪: ${mockChannel.code} (enabled=${mockChannel.enabled})`)

  // 默认智能体（开箱即用）：用户在 H5「AI 助手」页授权后即可对话。
  // LLM_PROVIDER=mock 时为模板回复，配置真实 LLM Key 后自动升级为智能对话。
  const defaultAgentNo = 'AGTDEFAULT00000001'
  const existingAgent = await prisma.agent.findUnique({ where: { agentNo: defaultAgentNo } })
  if (!existingAgent) {
    await prisma.agent.create({
      data: {
        agentNo: defaultAgentNo,
        name: '科佰钱包管家',
        appSecret: createHash('sha256').update('agent-' + randomBytes(24).toString('hex')).digest('hex'),
        status: 'ACTIVE',
        scopes: JSON.stringify(['wallet']),
        scenario: 'wallet',
        version: '1.0.0',
        description: '默认钱包管家智能体：查余额、查账单、领优惠券等（资金类操作需用户二次确认）',
      },
    })
    console.log('  默认智能体已创建: 科佰钱包管家 (scenario=wallet, LLM_PROVIDER=mock 模板回复)')
  }

  console.log('seed 完成')
}

main()
  .catch((e) => {
    console.error('seed 失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
