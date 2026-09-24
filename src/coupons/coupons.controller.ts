import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { CouponsService } from './coupons.service'
import { CreateCouponDto, UpdateCouponStatusDto } from './dto/create-coupon.dto'
import { ListCouponDto, ListUserCouponDto } from './dto/list-coupon.dto'

@ApiTags('优惠券 / 折扣码')
@ApiBearerAuth('user-auth')
@Controller('coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  // ============== 商家管理 ==============

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiOperation({ summary: '创建优惠券' })
  @ApiResponse({ status: 201, description: '优惠券创建成功' })
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateCouponDto) {
    return this.couponsService.createCoupon(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get(':couponNo')
  @ApiOperation({ summary: '查询优惠券详情' })
  findByCouponNo(@Param('couponNo') couponNo: string) {
    return this.couponsService.findByCouponNo(couponNo)
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: '列出我创建的优惠券' })
  list(@CurrentUser() user: CurrentUserType, @Query() query: ListCouponDto) {
    return this.couponsService.listCoupons(user.id, query)
  }

  @UseGuards(JwtAuthGuard)
  @Put(':couponNo/status')
  @ApiOperation({ summary: '启用/禁用优惠券' })
  setCouponStatus(
    @CurrentUser() user: CurrentUserType,
    @Param('couponNo') couponNo: string,
    @Body() dto: UpdateCouponStatusDto,
  ) {
    return this.couponsService.setCouponStatus(user.id, couponNo, dto.status as 'ACTIVE' | 'DISABLED')
  }

  // ============== 用户领取与使用 ==============

  @UseGuards(JwtAuthGuard)
  @Post(':couponNo/claim')
  @ApiOperation({ summary: '领取优惠券' })
  @ApiResponse({ status: 201, description: '领取成功' })
  claim(
    @CurrentUser() user: CurrentUserType,
    @Param('couponNo') couponNo: string,
  ) {
    return this.couponsService.claim(user.id, couponNo)
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine/list')
  @ApiOperation({ summary: '列出我领取的优惠券' })
  listMine(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListUserCouponDto,
  ) {
    return this.couponsService.listMyCoupons(user.id, query)
  }

  // 注：原「使用优惠券」核销端点已下线。
  // 原因：项目无订单实体，优惠券抵扣从未接入任何支付流（充值/转账/红包均不校验券），
  // 该端点只能把券标记为 USED 而无真实支付效果，属于孤岛功能。
  // 未来接入真实支付立减时，应在支付结算事务内原子核销（方案见重构报告 P2-3）。

  @UseGuards(JwtAuthGuard)
  @Get('mine/:userCouponNo')
  @ApiOperation({ summary: '查询用户优惠券详情' })
  findMine(
    @CurrentUser() user: CurrentUserType,
    @Param('userCouponNo') userCouponNo: string,
  ) {
    return this.couponsService.findUserCoupon(user.id, userCouponNo)
  }
}
