import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { AdminController } from './admin.controller.js'
import { AdminService } from './admin.service.js'
import { MerchantsService } from '../merchants/merchants.service.js'
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard.js'
import { PermissionsGuard } from './permissions.guard.js'

describe('AdminController', () => {
  let controller: AdminController
  const mockAdminService = {
    getDashboardStats: jest.fn().mockResolvedValue({ totalUsers: 10 }),
    listUsers: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    getUserDetail: jest.fn().mockResolvedValue({ id: 'u1' }),
    updateUserStatus: jest.fn().mockResolvedValue({ id: 'u1' }),
    updateUserRiskLevel: jest.fn().mockResolvedValue({ id: 'u1' }),
    listMerchants: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    listPaymentOrders: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    listRiskEvents: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    handleRiskEvent: jest.fn().mockResolvedValue({ id: 'e1' }),
    listLoginLogs: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    getRiskRules: jest.fn().mockResolvedValue([]),
    updateRiskRule: jest.fn().mockResolvedValue({ code: 'r1' }),
    listPendingIdentities: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    approveIdentity: jest.fn().mockResolvedValue({ id: 'i1' }),
    rejectIdentity: jest.fn().mockResolvedValue({ id: 'i1' }),
    listAuditLogs: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    logAction: jest.fn().mockResolvedValue(undefined),
  }
  const mockMerchantsService = {
    auditMerchant: jest.fn().mockResolvedValue({ id: 'm1' }),
    updateMerchantConfig: jest.fn().mockResolvedValue({ id: 'm1' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: MerchantsService, useValue: mockMerchantsService },
      ],
    })
      .overrideGuard(AdminJwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { sub: 'a1', username: 'admin', role: 'SUPER_ADMIN' }
          return true
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile()
    controller = moduleRef.get(AdminController)
  })

  beforeEach(() => jest.clearAllMocks())

  const req = () => ({ headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' }) as any
  const admin = () => ({ sub: 'a1', role: 'SUPER_ADMIN' }) as any
  const auditMeta = { ip: '127.0.0.1', userAgent: 'jest' }

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('getDashboardStats 透传到 service', async () => {
    await controller.getDashboardStats()
    expect(mockAdminService.getDashboardStats).toHaveBeenCalledWith()
  })

  it('listUsers 透传 query', async () => {
    const query = { page: 1, limit: 10 }
    await controller.listUsers(query as any)
    expect(mockAdminService.listUsers).toHaveBeenCalledWith(query)
  })

  it('getUserDetail 透传 id', async () => {
    await controller.getUserDetail('u1')
    expect(mockAdminService.getUserDetail).toHaveBeenCalledWith('u1')
  })

  it('updateUserStatus 透传 id/status/reason/adminId/auditMeta', async () => {
    const dto = { status: 'FROZEN', reason: '违规' }
    await controller.updateUserStatus('u1', dto as any, admin(), req())
    expect(mockAdminService.updateUserStatus).toHaveBeenCalledWith('u1', 'FROZEN', '违规', 'a1', auditMeta)
  })

  it('updateUserRiskLevel 透传 id/level/adminId/auditMeta', async () => {
    const dto = { level: 'HIGH' }
    await controller.updateUserRiskLevel('u1', dto as any, admin(), req())
    expect(mockAdminService.updateUserRiskLevel).toHaveBeenCalledWith('u1', 'HIGH', 'a1', auditMeta)
  })

  it('listMerchants 透传 query', async () => {
    const query = { page: 1 }
    await controller.listMerchants(query as any)
    expect(mockAdminService.listMerchants).toHaveBeenCalledWith(query)
  })

  it('auditMerchant: APPROVE 透传商户状态并记录审计', async () => {
    const dto = { action: 'APPROVE' }
    const res = await controller.auditMerchant('m1', dto as any, admin(), req())
    expect(mockMerchantsService.auditMerchant).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ status: expect.any(String) }),
      'a1',
    )
    expect(mockAdminService.logAction).toHaveBeenCalledWith('a1', 'MERCHANT_AUDIT', 'm1', { action: 'APPROVE', reason: undefined }, auditMeta)
    expect(res).toEqual({ id: 'm1' })
  })

  it('auditMerchant: REJECT 缺 reason 时 400，不调商户 service', async () => {
    const dto = { action: 'REJECT' }
    await expect(controller.auditMerchant('m1', dto as any, admin(), req())).rejects.toBeInstanceOf(BadRequestException)
    expect(mockMerchantsService.auditMerchant).not.toHaveBeenCalled()
  })

  it('updateMerchantConfig 透传并记录审计', async () => {
    const dto = { dailyLimit: 100000 }
    await controller.updateMerchantConfig('m1', dto as any, admin(), req())
    expect(mockMerchantsService.updateMerchantConfig).toHaveBeenCalledWith('m1', dto)
    expect(mockAdminService.logAction).toHaveBeenCalledWith('a1', 'MERCHANT_CONFIG_UPDATE', 'm1', dto, auditMeta)
  })

  it('listPaymentOrders / listRiskEvents / listLoginLogs / listAuditLogs 透传 query', async () => {
    const q = { page: 1 }
    await controller.listPaymentOrders(q as any)
    expect(mockAdminService.listPaymentOrders).toHaveBeenCalledWith(q)
    await controller.listRiskEvents(q as any)
    expect(mockAdminService.listRiskEvents).toHaveBeenCalledWith(q)
    await controller.listLoginLogs(q as any)
    expect(mockAdminService.listLoginLogs).toHaveBeenCalledWith(q)
    await controller.listAuditLogs(q as any)
    expect(mockAdminService.listAuditLogs).toHaveBeenCalledWith(q)
  })

  it('handleRiskEvent 透传 id/adminId/auditMeta/note', async () => {
    const dto = { note: '人工解除' }
    await controller.handleRiskEvent('e1', dto as any, admin(), req())
    expect(mockAdminService.handleRiskEvent).toHaveBeenCalledWith('e1', 'a1', auditMeta, '人工解除')
  })

  it('getRiskRules / updateRiskRule 透传', async () => {
    await controller.getRiskRules()
    expect(mockAdminService.getRiskRules).toHaveBeenCalledWith()
    const dto = { enabled: false, threshold: 5 }
    await controller.updateRiskRule('R1', dto as any, admin(), req())
    expect(mockAdminService.updateRiskRule).toHaveBeenCalledWith('R1', dto, 'a1', auditMeta)
  })

  it('listPendingIdentities 透传 query', async () => {
    const q = { page: 1 }
    await controller.listPendingIdentities(q as any)
    expect(mockAdminService.listPendingIdentities).toHaveBeenCalledWith(q)
  })

  it('approveIdentity 透传 id/adminId/auditMeta', async () => {
    await controller.approveIdentity('i1', admin(), req())
    expect(mockAdminService.approveIdentity).toHaveBeenCalledWith('i1', 'a1', auditMeta)
  })

  it('rejectIdentity 透传 id/reason/adminId/auditMeta', async () => {
    const dto = { reason: '照片模糊' }
    await controller.rejectIdentity('i1', dto as any, admin(), req())
    expect(mockAdminService.rejectIdentity).toHaveBeenCalledWith('i1', '照片模糊', 'a1', auditMeta)
  })
})
