import { describe, expect, it, jest } from '@jest/globals'
import { UnauthorizedException } from '@nestjs/common'
import { MetricsController } from './metrics.controller.js'
import { MetricsService } from './metrics.service.js'
import { ConfigService } from '@nestjs/config'

describe('MetricsController token 校验（L1 常量时间比较）', () => {
  const metricsService = { metrics: jest.fn().mockResolvedValue('# HELP\n# TYPE kb_total counter\nkb_total 0') }

  const build = (token?: string, nodeEnv = 'development') =>
    new MetricsController(
      metricsService as unknown as MetricsService,
      // 注意：这里返回 undefined 才代表"未配置"，不能把 NODE_ENV 混进 token 查询
      {
        get: (key: string) => (key === 'METRICS_TOKEN' ? token : key === 'NODE_ENV' ? nodeEnv : undefined),
      } as unknown as ConfigService,
    )

  const reqWith = (authorization: string) =>
    ({ headers: { authorization } }) as never

  it('开发环境未配置 METRICS_TOKEN 时保持开放', async () => {
    await expect(build(undefined, 'development').metrics(reqWith(''))).resolves.toContain('# HELP')
  })

  it('生产环境未配置 METRICS_TOKEN 直接拒绝（纵深防御）', async () => {
    await expect(build(undefined, 'production').metrics(reqWith(''))).rejects.toThrow(
      UnauthorizedException,
    )
  })

  it('生产环境配置 token 且 Bearer 正确时放行', async () => {
    await expect(
      build('unit-secret', 'production').metrics(reqWith('Bearer unit-secret')),
    ).resolves.toContain('# HELP')
  })

  it('正确的 Bearer token 放行', async () => {
    await expect(build('unit-secret').metrics(reqWith('Bearer unit-secret'))).resolves.toContain('# HELP')
  })

  it('错误 token 拒绝并抛 UnauthorizedException', async () => {
    await expect(build('unit-secret').metrics(reqWith('Bearer wrong'))).rejects.toThrow(
      UnauthorizedException,
    )
    await expect(build('unit-secret').metrics(reqWith(''))).rejects.toThrow(UnauthorizedException)
  })
})
