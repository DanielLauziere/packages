import { describe, it, expect } from 'vitest'
import { isPromotionScheduled } from './promotionSchedule.js'
import type { PromotionDB } from './types.js'

// 2026-01-05 is a Monday; 2026-01-07 is a Wednesday (local-time getDay()).
const MONDAY = new Date(2026, 0, 5, 12, 0, 0)
const WEDNESDAY = new Date(2026, 0, 7, 12, 0, 0)
const SUNDAY = new Date(2026, 0, 11, 12, 0, 0)

const base: PromotionDB = {
  uuid: 'p',
  name: '',
  active: true,
  type: 'REWARD',
  itemless: true,
  bogo_buy: '',
  bogo_get: '',
  points_required: 0,
  points_multiplier: 0,
  promotion_is_percentage: false,
  discount_percent: 0,
  discount_whole: 0,
  discount_hundredths: 0,
  location_group_uuid: 'lg',
}

describe('isPromotionScheduled', () => {
  it('all_week short-circuits the day flags', () => {
    expect(isPromotionScheduled({ ...base, all_week: true, mon: false }, WEDNESDAY)).toBe(true)
  })

  it('offers on the selected day', () => {
    expect(isPromotionScheduled({ ...base, all_week: false, mon: true }, MONDAY)).toBe(true)
  })

  it('withholds on an unselected day', () => {
    expect(isPromotionScheduled({ ...base, all_week: false, mon: true }, WEDNESDAY)).toBe(false)
  })

  it('sunday uses getDay() === 0', () => {
    expect(isPromotionScheduled({ ...base, all_week: false, sun: true }, SUNDAY)).toBe(true)
    expect(isPromotionScheduled({ ...base, all_week: false, sun: true }, MONDAY)).toBe(false)
  })

  it('all_week false with no day flag is never offerable', () => {
    expect(isPromotionScheduled({ ...base, all_week: false }, MONDAY)).toBe(false)
  })

  it('a partial row with no schedule fields stays unrestricted', () => {
    const { all_week: _aw, mon: _m, tue: _t, wed: _w, thu: _th, fri: _f, sat: _s, sun: _su, ...rest } = base
    expect(isPromotionScheduled(rest, WEDNESDAY)).toBe(true)
  })

  it('null / undefined promotion is not offerable', () => {
    expect(isPromotionScheduled(null, MONDAY)).toBe(false)
    expect(isPromotionScheduled(undefined, MONDAY)).toBe(false)
  })
})
