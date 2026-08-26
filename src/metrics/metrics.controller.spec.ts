import { UnauthorizedException } from '@nestjs/common'
import { MetricsController } from './metrics.controller'
import { MetricsService } from './metrics.service'
import { ConfigService } from '@nestjs/config'

describe('MetricsController token 校验（L1 常量时间比较）', () => {
  const metricsService = { metrics: jest.fn().mockResolvedValue('# HELP\n# TYPE kb_total counter\nkb_total 0') }

  const build = (token?: string) =>
    new MetricsController(
      metricsService as unknown as MetricsService,
      { get: () => token } as unknown as ConfigService,
    )

  const reqWith = (authorization: string) =>
    ({ headers: { authorization } }) as never

  it('未配置 METRICS_TOKEN 时保持开放', async () => {
    await expect(build(undefined).metrics(reqWith(''))).resolves.toContain('# HELP')
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
