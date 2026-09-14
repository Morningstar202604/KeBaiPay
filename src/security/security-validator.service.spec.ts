import { SecurityValidatorService } from './security-validator.service'
import { ConfigService } from '@nestjs/config'

/**
 * 生产环境安全校验测试
 *
 * SecurityValidatorService.validate() 是"配置错了就拒绝启动"的最后闸门，
 * 这里逐条验证每类错误都会真的拦下来——否则部署侧一个手误（比如照抄
 * .env.example 里的默认值）就可能把开发密钥带上生产。
 */
describe('SecurityValidatorService', () => {
  const secret32 = 'a'.repeat(32)

  const build = (env: Record<string, string | undefined>) => {
    const config = {
      get: (key: string, def?: string) => (key in env ? env[key] ?? def : def),
    } as unknown as ConfigService
    return new SecurityValidatorService(config)
  }

  // 一套能通过全部校验的生产配置，各用例在此基础上破坏单项
  const prodEnv = {
    NODE_ENV: 'production',
    JWT_USER_SECRET: secret32,
    JWT_ADMIN_SECRET: secret32,
    JWT_AGENT_SECRET: secret32,
    ADMIN_DEFAULT_PASSWORD: 'StrongAdmin#2026',
    ENCRYPTION_KEY: secret32,
    REDIS_URL: 'redis://redis:6379',
    CORS_ORIGINS: 'https://pay.example.com',
    RECHARGE_NOTIFY_URL: 'https://api.example.com/callback',
    METRICS_TOKEN: 'm'.repeat(24),
  }

  it('生产环境配置齐全时校验通过', () => {
    expect(() => build(prodEnv).validate()).not.toThrow()
  })

  it('任何环境缺少密钥都拒绝启动（未配置是硬错误，不区分环境）', () => {
    try {
      build({ NODE_ENV: 'development' }).validate()
      fail('缺密钥时应当拒绝启动')
    } catch (e) {
      expect((e as Error).message).toContain('JWT_USER_SECRET 未配置')
    }
  })

  it('生产环境缺少任一密钥时拒绝启动', () => {
    for (const key of ['JWT_USER_SECRET', 'JWT_ADMIN_SECRET', 'JWT_AGENT_SECRET', 'ENCRYPTION_KEY']) {
      const env = { ...prodEnv, [key]: undefined }
      try {
        build(env).validate()
        fail(`应当拒绝启动：${key} 未配置`)
      } catch (e) {
        expect((e as Error).message).toContain(key)
      }
    }
  })

  it('生产环境使用默认密钥时拒绝启动', () => {
    for (const value of ['change-user-secret-in-production', 'kb-user-secret-dev-2024-not-for-prod']) {
      const env = { ...prodEnv, JWT_USER_SECRET: value }
      expect(() => build(env).validate()).toThrow(/默认值/)
    }
  })

  it('开发环境使用默认密钥只告警不拒绝', () => {
    expect(() =>
      build({
        NODE_ENV: 'development',
        JWT_USER_SECRET: 'change-user-secret-in-production',
        JWT_ADMIN_SECRET: secret32,
        JWT_AGENT_SECRET: secret32,
        ADMIN_DEFAULT_PASSWORD: 'StrongAdmin#2026',
        ENCRYPTION_KEY: secret32,
      }).validate(),
    ).not.toThrow()
  })

  it('生产环境密钥长度不足 32 位时拒绝启动', () => {
    const env = { ...prodEnv, JWT_ADMIN_SECRET: 'a'.repeat(31) }
    expect(() => build(env).validate()).toThrow(/长度不足 32 位/)
  })

  it('生产环境管理员密码缺少字符复杂度时拒绝启动', () => {
    // 只有大小写没有数字 -> 必须同时含大小写与数字
    const env = { ...prodEnv, ADMIN_DEFAULT_PASSWORD: 'Abcdefgh' }
    expect(() => build(env).validate()).toThrow(/大写字母、小写字母和数字/)
  })

  it('生产环境缺少 REDIS_URL 时拒绝启动', () => {
    const env = { ...prodEnv, REDIS_URL: undefined }
    expect(() => build(env).validate()).toThrow(/REDIS_URL/)
  })

  it('生产环境缺少 CORS_ORIGINS 时拒绝启动', () => {
    const env = { ...prodEnv, CORS_ORIGINS: undefined }
    expect(() => build(env).validate()).toThrow(/CORS_ORIGINS/)
  })

  it('生产环境 CORS_ORIGINS 含 localhost 不拒绝但应当只在真实域名场景下收紧', () => {
    // localhost 仅告警（日志），不阻断启动 —— 行为锁定，避免后续误改成硬失败
    const env = { ...prodEnv, CORS_ORIGINS: 'http://localhost:3000' }
    expect(() => build(env).validate()).not.toThrow()
  })

  it('生产环境 RECHARGE_NOTIFY_URL 缺失/非 URL/指向 localhost 均拒绝启动', () => {
    expect(() => build({ ...prodEnv, RECHARGE_NOTIFY_URL: undefined }).validate()).toThrow(
      /RECHARGE_NOTIFY_URL/,
    )
    expect(() => build({ ...prodEnv, RECHARGE_NOTIFY_URL: '/api/callback' }).validate()).toThrow(
      /http\(s\)/,
    )
    expect(() =>
      build({ ...prodEnv, RECHARGE_NOTIFY_URL: 'http://localhost:3000/notify' }).validate(),
    ).toThrow(/localhost/)
  })

  it('生产环境未配置 METRICS_TOKEN 或长度不足时拒绝启动', () => {
    expect(() => build({ ...prodEnv, METRICS_TOKEN: undefined }).validate()).toThrow(
      /METRICS_TOKEN/,
    )
    expect(() => build({ ...prodEnv, METRICS_TOKEN: 'short' }).validate()).toThrow(/METRICS_TOKEN/)
  })
})
