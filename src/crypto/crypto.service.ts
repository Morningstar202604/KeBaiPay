import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { maskBankCard } from '../common/mask'

/**
 * 敏感字段加密服务
 *
 * 使用 AES-256-GCM 对称加密，适用于身份证号、银行卡号等敏感数据的加密存储。
 * 密钥从环境变量 ENCRYPTION_KEY 派生，未配置时直接抛错拒绝启动（避免弱密钥加密敏感数据）。
 *
 * 存储格式：base64(iv:ciphertext:authTag)
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name)
  private key!: Buffer

  private readonly ALGORITHM = 'aes-256-gcm'
  private readonly IV_LENGTH = 12
  // salt 固定值：用于 scrypt 密钥派生，与历史密文兼容；轮换密钥需重新加密全量数据
  private readonly SALT = 'kebaipay-salt-v1'
  // 渠道配置密文前缀：标识该字符串为 AES-256-GCM 密文（前缀后为 base64(iv:ciphertext:authTag)）
  private readonly CONFIG_ENC_PREFIX = 'enc:v1:'

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY')
    if (!encryptionKey || encryptionKey.length < 32) {
      // 未配置或长度不足直接 fatal，避免开发环境误用弱密钥加密生产数据
      throw new Error(
        'ENCRYPTION_KEY 未配置或长度不足 32 字符，拒绝启动。请在 .env 中设置 32 字符以上的随机字符串。',
      )
    }
    this.key = scryptSync(encryptionKey, this.SALT, 32)
    this.logger.log('ENCRYPTION_KEY 已加载，敏感字段加密服务就绪')
  }

  /**
   * 加密明文
   * @returns base64(iv:ciphertext:authTag)
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(this.IV_LENGTH)
    const cipher = createCipheriv(this.ALGORITHM, this.key, iv)
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()
    return Buffer.concat([iv, ciphertext, authTag]).toString('base64')
  }

  /**
   * 解密
   * @param encrypted base64(iv:ciphertext:authTag)
   */
  decrypt(encrypted: string): string {
    const buf = Buffer.from(encrypted, 'base64')
    const iv = buf.subarray(0, this.IV_LENGTH)
    const authTag = buf.subarray(buf.length - 16)
    const ciphertext = buf.subarray(this.IV_LENGTH, buf.length - 16)
    const decipher = createDecipheriv(this.ALGORITHM, this.key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
  }

  /**
   * 加密配置对象中的字符串值（渠道凭据等敏感配置落库前调用）
   *
   * 仅处理非空 string 值，输出带 enc:v1: 前缀的密文；其余类型原样保留。
   * 已带前缀的值不重复加密（幂等），支持重复保存同一配置。
   */
  encryptConfigValues(config: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(config)) {
      if (
        typeof value === 'string' &&
        value !== '' &&
        !value.startsWith(this.CONFIG_ENC_PREFIX)
      ) {
        out[key] = this.CONFIG_ENC_PREFIX + this.encrypt(value)
      } else {
        out[key] = value
      }
    }
    return out
  }

  /**
   * 解密配置对象中带 enc:v1: 前缀的字符串值（业务读取配置时调用）
   *
   * 未带前缀的值原样返回——兼容历史明文存量数据，实现平滑迁移；
   * 单个字段解密失败时保留原值并记录告警，避免一个坏字段阻断整个渠道。
   */
  decryptConfigValues(config: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string' && value.startsWith(this.CONFIG_ENC_PREFIX)) {
        try {
          out[key] = this.decrypt(value.slice(this.CONFIG_ENC_PREFIX.length))
        } catch (err) {
          this.logger.warn(
            `配置字段 ${key} 解密失败（密钥不匹配或密文损坏），已保留原值: ${err instanceof Error ? err.message : err}`,
          )
          out[key] = value
        }
      } else {
        out[key] = value
      }
    }
    return out
  }

  /**
   * 脱敏显示：委托给 common/mask 统一实现
   * 保留首尾各几位，中间用 **** 替代
   */
  mask(value: string, headKeep = 4, tailKeep = 4): string {
    if (!value) return ''
    if (value.length <= headKeep + tailKeep) return '****'
    // 默认参数与 maskBankCard 一致，直接复用
    if (headKeep === 4 && tailKeep === 4) return maskBankCard(value)
    return `${value.slice(0, headKeep)}****${value.slice(-tailKeep)}`
  }
}
