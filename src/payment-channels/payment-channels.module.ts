import { Global, Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { PaymentChannelRegistry } from './payment-channel.registry'
import { RefundService } from './refund.service'
import { ChannelHealthService } from './channel-health.service'

// 新增 —— Connector 体系
import { ConnectorRegistry } from './connector.registry'
import { ConnectorRouter } from './connector-router'
import { ConnectorHealthService } from './connector-health.service'
import { PaymentChannelBridge } from './payment-channel.bridge'

// 老 channels（兼容层）
import { MockChannel } from './channels/mock.channel'
import { WechatPayChannel } from './channels/wechat-pay.channel'
import { AlipayChannel } from './channels/alipay.channel'

// 新增 Connectors
import { AlipayConnector } from './connectors/alipay.connector'
import { WechatPayConnector } from './connectors/wechat-pay.connector'
import { MockConnector } from './connectors/mock.connector'
import { UnionPayConnector } from './connectors/unionpay.connector'
import { StripeConnector } from './connectors/stripe.connector'

import { PrismaModule } from '../prisma/prisma.module'
import { RedisModule } from '../redis/redis.module'

@Global()
@Module({
  imports: [PrismaModule, RedisModule, HttpModule],
  providers: [
    // 兼容层
    PaymentChannelRegistry,
    RefundService,
    ChannelHealthService,
    MockChannel,
    WechatPayChannel,
    AlipayChannel,
    // 新 Connector 体系
    // 顺序很重要：Connector 必须在 ConnectorRegistry 之前实例化
    AlipayConnector,
    WechatPayConnector,
    MockConnector,
    UnionPayConnector,
    StripeConnector,
    ConnectorRegistry,
    ConnectorRouter,
    ConnectorHealthService,
    PaymentChannelBridge,
  ],
  exports: [
    // 兼容层
    PaymentChannelRegistry,
    RefundService,
    ChannelHealthService,
    MockChannel,
    WechatPayChannel,
    AlipayChannel,
    // 导出新 Connector 体系供其他模块使用
    ConnectorRegistry,
    ConnectorRouter,
    ConnectorHealthService,
    PaymentChannelBridge,
    AlipayConnector,
    WechatPayConnector,
    MockConnector,
    UnionPayConnector,
    StripeConnector,
  ],
})
export class PaymentChannelsModule {}
