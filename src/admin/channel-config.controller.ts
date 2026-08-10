import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { Request } from 'express'
import { AdminJwtAuthGuard } from '../admin/admin-jwt-auth.guard'
import { PermissionsGuard } from '../admin/permissions.guard'
import { RequirePermissions } from '../admin/permissions.decorator'
import { AdminCurrentUser } from '../admin/admin-current-user.decorator'
import { AdminCurrentUser as AdminCurrentUserType } from '../admin/admin-current-user.interface'
import { ChannelConfigService } from './channel-config.service'
import { IsString, IsBoolean, IsNumber, IsOptional, Min } from 'class-validator'

class CreateChannelConfigDto {
  @IsString() code!: string
  @IsString() name!: string
  @IsString() type!: string
  @IsBoolean() enabled = false
  @IsNumber() @Min(0) priority = 0
  @IsOptional() @IsString() config = '{}'
}

class UpdateChannelConfigDto {
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsString() type?: string
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @IsNumber() @Min(0) priority?: number
  @IsOptional() @IsString() config?: string
}

@ApiTags('管理后台')
@ApiBearerAuth('user-auth')
@Controller('admin/channels')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class ChannelConfigController {
  constructor(private readonly channelConfigService: ChannelConfigService) {}

  @Get()
  @RequirePermissions('admin:view')
  @ApiOperation({ summary: '支付渠道列表', description: '查询所有支付渠道配置（敏感字段已脱敏）' })
  @ApiResponse({ status: 200, description: '返回渠道列表' })
  listChannels() {
    return this.channelConfigService.listChannels()
  }

  @Post()
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '创建支付渠道' })
  @ApiResponse({ status: 201, description: '渠道创建成功' })
  createChannel(
    @Body() dto: CreateChannelConfigDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    return this.channelConfigService.createChannel(dto, {
      admin,
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string,
    })
  }

  @Put(':code')
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '更新支付渠道' })
  @ApiResponse({ status: 200, description: '渠道更新成功' })
  updateChannel(
    @Param('code') code: string,
    @Body() dto: UpdateChannelConfigDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    return this.channelConfigService.updateChannel(code, dto, {
      admin,
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string,
    })
  }

  @Delete(':code')
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '删除支付渠道' })
  @ApiResponse({ status: 200, description: '删除成功' })
  deleteChannel(
    @Param('code') code: string,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    return this.channelConfigService.deleteChannel(code, {
      admin,
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string,
    })
  }

  @Post(':code/test')
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '测试支付渠道', description: '验证渠道是否可用' })
  @ApiResponse({ status: 200, description: '渠道可用' })
  testChannel(@Param('code') code: string) {
    return this.channelConfigService.testChannel(code)
  }
}
