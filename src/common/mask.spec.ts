import { describe, expect, it } from '@jest/globals'
import {
  maskPhone,
  maskIdCard,
  maskBankCard,
} from './mask.js'

describe('common/mask', () => {
  describe('maskPhone', () => {
    it('保留前 3 后 4，中间 ****', () => {
      expect(maskPhone('13812341234')).toBe('138****1234')
    })

    it('过短返回 ****', () => {
      expect(maskPhone('1234567')).toBe('****')
    })

    it('空值返回 ****', () => {
      expect(maskPhone('')).toBe('****')
    })
  })

  describe('maskIdCard', () => {
    it('18 位身份证保留前 3 后 4，中间逐位 *', () => {
      expect(maskIdCard('110101199001011234')).toBe('110***********1234')
    })

    it('过短返回 ****', () => {
      expect(maskIdCard('1234567')).toBe('****')
    })

    it('空值返回 ****', () => {
      expect(maskIdCard('')).toBe('****')
    })
  })

  describe('maskBankCard', () => {
    it('保留前 4 后 4，中间 ****', () => {
      expect(maskBankCard('622812341234')).toBe('6228****1234')
    })

    it('16 位卡号保留前 4 后 4', () => {
      expect(maskBankCard('6228123412345678')).toBe('6228****5678')
    })

    it('过短返回 ****', () => {
      expect(maskBankCard('12345678')).toBe('****')
    })

    it('空值返回 ****', () => {
      expect(maskBankCard('')).toBe('****')
    })
  })
})
