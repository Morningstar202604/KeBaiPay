import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { Response } from 'express'
import { AdminCurrentUser } from '../admin/admin-current-user.decorator'
import { AdminCurrentUser as AdminCurrentUserType } from '../admin/admin-current-user.interface'
import { AdminJwtAuthGuard } from '../admin/admin-jwt-auth.guard'
import { PermissionsGuard } from '../admin/permissions.guard'
import { RequirePermissions } from '../admin/permissions.decorator'
import { ReconciliationService } from './reconciliation.service'
import { RunReconciliationDto } from './dto/run-reconciliation.dto'
import { RunChannelReconciliationDto, ChannelBillChecksQueryDto } from './dto/channel-bill.dto'
import { ReportsQueryDto } from './dto/reports-query.dto'

@ApiTags('财务')
@ApiBearerAuth('user-auth')
@Controller('admin/reconciliation')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post('run')
  @RequirePermissions('reconciliation:run')
  @ApiOperation({ summary: '执行对账', description: '对指定日期进行对账' })
  @ApiResponse({ status: 201, description: '对账完成' })
  runReconciliation(
    @Body() dto: RunReconciliationDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
  ) {
    return this.reconciliationService.runReconciliation(dto.date, admin?.sub)
  }

  @Get('reports')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '对账报告列表' })
  @ApiResponse({ status: 200, description: '返回对账报告列表' })
  getReports(@Query() query: ReportsQueryDto) {
    return this.reconciliationService.getReports(query)
  }

  @Get('reports/export')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '导出对账报告 CSV' })
  @ApiResponse({ status: 200, description: 'CSV 文件下载' })
  async exportReports(
    @Query() query: ReportsQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.reconciliationService.exportReports(query)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="reconciliation-reports.csv"',
    )
    res.send(csv)
  }

  @Get('reports/:date')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '查询指定日期对账报告' })
  @ApiResponse({ status: 200, description: '返回对账报告详情' })
  getReport(@Param('date') date: string) {
    return this.reconciliationService.getReport(date)
  }

  // ============ 通道账单对账（合规聚合模式：资金核对证据链） ============

  @Post('channel-bill/generate')
  @RequirePermissions('reconciliation:run')
  @ApiOperation({ summary: '生成模拟通道账单', description: '基于当日收单订单生成模拟账单文件（真实商户号接入后由官方账单替换）' })
  @ApiResponse({ status: 201, description: '返回模拟账单 CSV 与摘要' })
  async generateMockChannelBill(
    @Query('date') date: string,
    @Query('channel') channel?: string,
  ) {
    return this.reconciliationService.generateMockChannelBill(date, channel || 'mock')
  }

  @Post('channel-bill/reconcile')
  @RequirePermissions('reconciliation:run')
  @ApiOperation({ summary: '执行通道账单核对', description: '按日期+通道逐笔核对平台订单与通道账单；支持差异注入用于演练' })
  @ApiResponse({ status: 201, description: '返回核对结果与差异明细' })
  runChannelReconciliation(
    @Body() dto: RunChannelReconciliationDto,
  ) {
    return this.reconciliationService.runChannelReconciliation(
      dto.date,
      dto.channel || 'mock',
      {
        missingPlatformOrders: dto.missingPlatformOrders,
        extraChannelOrders: dto.extraChannelOrders,
        amountMismatchOrders: dto.amountMismatchOrders,
        billSource: dto.billSource,
        billText: dto.billText,
      },
    )
  }

  @Get('channel-bill/checks')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '通道账单核对记录列表' })
  @ApiResponse({ status: 200, description: '返回核对记录' })
  getChannelBillChecks(@Query() query: ChannelBillChecksQueryDto) {
    return this.reconciliationService.getChannelBillChecks(query)
  }
}
