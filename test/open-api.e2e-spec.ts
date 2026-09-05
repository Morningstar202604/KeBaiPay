import { Test } from '@nestjs/testing'
import { ValidationPipe, INestApplication } from '@nestjs/common'
import { createHash, createHmac } from 'crypto'
import { ThrottlerModule } from '@nestjs/throttler'
import { ConfigModule } from '@nestjs/config'
import request from 'supertest'
import { OpenApiController } from '../src/open-api/open-api.controller'
import { OpenApiService } from '../src/open-api/open-api.service'
import { OpenApiGuard } from '../src/open-api/open-api.guard'
import { PrismaService } from '../src/prisma/prisma.service'
import { RedisService } from '../src/redis/redis.service'
import { RiskEngineService } from '../src/risk/risk-engine.service'

// 商户侧只有明文 appSecret；服务端 DB 只存其 SHA-256 hex 摘要
const PLAINTEXT_SECRET = 'secret_e2e'
const APP_ID = 'app_xxx'

/** 按 public/sdk/kebaipay.js 口径签名：key = sha256(明文) 的 32 字节原始摘要 */
function signLikeSdk(
  method: string,
  path: string,
  rawBody: string,
  timestamp: string,
  nonce: string,
) {
  const signString = `${method}\n${path}\n${rawBody}\n${timestamp}\n${nonce}\n${APP_ID}`
  const key = createHash('sha256').update(PLAINTEXT_SECRET, 'utf8').digest()
  return createHmac('sha256', key).update(signString, 'utf8').digest('hex')
}

describe('OpenApiController (e2e)', () => {
  let app: INestApplication
  const mockPrisma = {
    merchantApp: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'app1',
        appId: APP_ID,
        appSecret: createHash('sha256').update(PLAINTEXT_SECRET).digest('hex'),
        merchantId: 'm1',
        status: 'ACTIVE',
      }),
    },
    merchant: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'm1',
        status: 'APPROVED',
        userId: 'u2',
      }),
    },
  }
  const mockRedis = {
    isEnabled: jest.fn().mockReturnValue(false),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<any>) => fn()),
  }
  const mockRiskEngine = {
    check: jest.fn().mockResolvedValue({ passed: true, blocked: false, warnings: [], rules: [] }),
  }
  const mockOpenApiService = {
    createOrder: jest.fn().mockResolvedValue({ orderNo: 'P1', amountYuan: '10.00' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(), ThrottlerModule.forRoot()],
      controllers: [OpenApiController],
      providers: [
        OpenApiGuard,
        { provide: OpenApiService, useValue: mockOpenApiService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: RiskEngineService, useValue: mockRiskEngine },
      ],
    }).compile()

    // rawBody: true 让 OpenApiGuard 能读到原始请求体参与验签（与 main.ts 生产配置一致）
    app = moduleRef.createNestApplication({ rawBody: true })
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('POST /open-api/v1/orders 缺少签名参数返回 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/open-api/v1/orders')
      .send({ merchantOrderNo: 'MO1', amount: 10, subject: '商品' })
      .expect(401)

    expect(response.body.message).toContain('KB401')
  })

  it('POST /open-api/v1/orders 带错误签名返回 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/open-api/v1/orders')
      .set('X-App-Id', 'app_xxx')
      .set('X-Timestamp', String(Math.floor(Date.now() / 1000)))
      .set('X-Signature', 'dummy')
      .send({ merchantOrderNo: 'MO1', amount: 10, subject: '商品' })
      .expect(401)

    expect(response.body.message).toContain('KB401')
  })

  // 防回归：此用例以真实 SDK 口径（sha256 预哈希 raw 摘要作 HMAC 密钥）签名，
  // 曾经服务端误用 hex 字符串作密钥导致真实商户恒 401，而失败路径测试无法发现
  it('POST /open-api/v1/orders 以 SDK 口径签名成功创建订单', async () => {
    const rawBody = JSON.stringify({ merchantOrderNo: 'MO1', amount: 10, subject: '商品' })
    const timestamp = String(Date.now())
    const nonce = `n_${Date.now()}_${Math.random().toString(36).slice(2)}`

    const response = await request(app.getHttpServer())
      .post('/open-api/v1/orders')
      .set('Content-Type', 'application/json')
      .set('X-App-Id', APP_ID)
      .set('X-Timestamp', timestamp)
      .set('X-Nonce', nonce)
      .set('X-Signature', signLikeSdk('POST', '/open-api/v1/orders', rawBody, timestamp, nonce))
      .send(rawBody)
      .expect(201)

    expect(response.body).toMatchObject({ orderNo: 'P1', amountYuan: '10.00' })
  })
})
