import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { Observable, map } from 'rxjs'

const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'hashedPassword',
  'hashed_password',
  'loginPassword',
  'login_password',
  'payPassword',
  'pay_password',
  'pendingPayPasswordHash',
  'appSecret',
  'app_secret',
  'secret',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'privateKey',
  'private_key',
  'encryptionKey',
  'encryption_key',
  'salt',
  'verificationCode',
  'verification_code',
  // 「加密列 + 哈希列」双列设计中的哈希列：可被离线穷举，一律不外发
  'idCardHash',
  'id_card_hash',
  'cardNumberHash',
  'card_number_hash',
  'phoneHash',
  'phone_hash',
])

/**
 * 响应转换拦截器
 *
 * 响应格式约定（见 src/common/api-response.ts）：
 * - 成功响应：body 直接返回业务数据（脱敏敏感字段后），不包裹 envelope
 * - 异常响应：由 AllExceptionsFilter 构造 ApiErrorResponse envelope
 * - X-Request-Id header 由 RequestLoggingMiddleware 设置，所有响应都带
 */
/**
 * 允许返回明文 appSecret 的端点白名单（方法 + 路径）。
 *
 * 背景：appSecret 只在创建应用/重新生成时明文下发一次（DB 只存哈希），
 * 若被全局脱敏，商户永远拿不到签名材料，开放 API HMAC 接入闭环断裂。
 * 这两个端点本身要求商户登录态 + 商户身份，且属于"仅此一次"的密钥展示，
 * 与列表/详情接口的脱敏需求不冲突。
 */
const SECRET_DISPLAY_ALLOWED = new Set([
  'POST /merchants/apps',
  'POST /merchants/apps/*/regenerate-secret',
])

function isSecretDisplayAllowed(req: Request): boolean {
  const path = req.path.replace(/\/+$/, '')
  for (const rule of SECRET_DISPLAY_ALLOWED) {
    const [method, pattern] = rule.split(' ')
    if (method !== req.method) continue
    const regex = new RegExp(
      `^${pattern.replace(/\*/g, '[^/]+').replace(/\//g, '\\/')}$`,
    )
    if (regex.test(path)) return true
  }
  return false
}

@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>()
    const res = context.switchToHttp().getResponse<Response>()
    // 确保响应头带 X-Request-Id（middleware 已设置，此处防御性确保异常路径外的所有响应都有）
    const traceId = req.headers['x-request-id'] as string | undefined
    if (traceId) {
      res.setHeader('X-Request-Id', traceId)
    }
    // 健康检查端点返回原始结构，k8s/docker probe 依赖 status 字段与状态码判断
    if (req.path.startsWith('/health')) {
      return next.handle()
    }
    // 密钥下发端点：保留 appSecret 明文（仅此一次展示），其余敏感字段仍脱敏
    if (isSecretDisplayAllowed(req)) {
      return next.handle().pipe(
        map((data) => this.stripSensitiveFields(data, new Set(['appSecret', 'app_secret']))),
      )
    }
    return next.handle().pipe(
      map((data) => this.stripSensitiveFields(data)),
    )
  }

  private stripSensitiveFields(data: unknown, skip?: Set<string>): unknown {
    if (data === null || data === undefined) {
      return data
    }

    // Date 实例必须原样保留（Express JSON 序列化时走 Date.toJSON 输出 ISO 字符串）。
    // 若落入下方 Object.entries 递归，Date 无可枚举属性会被洗成 {}，
    // 导致全端所有日期字段丢失（H5 账单/后台注册时间等全部损坏）。
    if (data instanceof Date) {
      return data
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.stripSensitiveFields(item, skip))
    }

    if (typeof data === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (SENSITIVE_FIELDS.has(key) && !(skip && skip.has(key))) {
          result[key] = '[REDACTED]'
        } else {
          result[key] = this.stripSensitiveFields(value, skip)
        }
      }
      return result
    }

    return data
  }
}
