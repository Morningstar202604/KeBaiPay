import { User } from '@prisma/client'

// P2 修复：payPassword 哈希同样不得进入控制器上下文（防日志/序列化泄露）
export type CurrentUser = Omit<User, 'loginPassword' | 'payPassword'>
