export type SetAnonymousAddressPayload = {
  address: string | null
}

export type AddItemPayload = {
  menu_item_uuid: string
}

export type RemoveItemPayload = {
  ticket_menu_item_uuid: string
}

export type SetItemNotePayload = {
  ticket_menu_item_uuid: string
  note: string | null
}

export type AddModifierPayload = {
  ticket_menu_item_uuid: string
  modifier_uuid: string
}

export type RemoveModifierPayload = {
  ticket_menu_item_modifier_uuid: string
}

export type ApplyPromotionPayload = {
  promotion_uuid: string
  ticket_menu_item_uuid?: string
}

export type RemovePromotionPayload = {
  promotion_uuid: string
}

export type AddPaymentPayload = {
  payment_uuid: string
  price_whole: number
  price_hundredths: number
  code?: string
  complete: boolean
}

export type TicketStatus = string

export type CompleteTicket = {
  uuid: string
  id: number
  time_stamp: string
  status: TicketStatus
  location_group_uuid: string
  app_unique_uuid: string
  fulfillment_uuid: string
  fulfillment_type: string
  guest_uuid: string
  guest_address_uuid: string
  table_uuid: string
  user_name: string
  first_name: string
  last_name: string
  email: string
  phone: string
  address: string
  anonymous_address: string
  points: number
  payment_uuid: string
}

export type MenuItemModifierGroupModifierDB = {
  uuid: string
  menu_item_uuid: string
  name: string
  active: boolean
  price_whole: number
  price_hundredths: number
  amount_required: number
}

export type MenuItemDB = {
  uuid: string
  cache: string
  name: string
  description: string
  active: boolean
  price_whole: number
  price_hundredths: number
}

export type PromotionDB = {
  uuid: string
  name: string
  active: boolean
  type: string
  itemless: boolean
  bogo_buy: string
  bogo_get: string
  points_required: number
  points_multiplier: number
  promotion_is_percentage: boolean
  discount_percent: number
  discount_whole: number
  discount_hundredths: number
  location_group_uuid: string
}

export type TicketPromotionDB = {
  uuid: string
  ticket_uuid: string
  promotion_uuid: string
  ticket_menu_item_uuid: string | null
  time_stamp: string
}

export type TicketMenuItemDB = {
  uuid: string
  ticket_uuid: string
  menu_item_uuid: string
  note: string | null
}

export type TicketMenuItemModifierDB = {
  uuid: string
  ticket_menu_item_uuid: string
  modifier_uuid: string
  ticket_uuid: string
}

export type BogoMenuItemDB = {
  uuid: string
  menu_item_uuid: string
  bogo_uuid: string
}

export type ComboDB = {
  uuid: string
  name: string
  description: string | null
  active: boolean
  price_whole: number
  price_hundredths: number
  combo_menu_items: ComboMenuItem[]
}

export type ComboMenuItem = {
  uuid: string
  ticket_uuid: string
  menu_item_uuid: string
  menu_item_cache: string
  name: string
}

export type TableDB = {
  uuid: string
  name: string
}

export type ComboComboMenuItemDB = {
  uuid: string
  name: string
  description: string
  active: boolean
  price_whole: number
  price_hundredths: number
  combo_uuid: string
  menu_item_uuid: string
}

export type ReturnPromotion = {
  uuid: string
  name: string
  active: boolean
  type: string
  itemless: boolean
  bogo_buy: string
  bogo_get: string
  points_required: number
  points_multiplier: number
  promotion_is_percentage: boolean
  discount_percent: number
  discount_whole: number
  discount_hundredths: number
  location_group_uuid: string
}

export type ReturnMenuItem = {
  uuid: string
  cache: string
  active: boolean
  name: string
  description: string
  price_whole: number
  price_hundredths: number
  original_price_whole: number
  original_price_hundredths: number
  ticket_menu_item_uuid: string
  ticket_menu_item_note: string | null
  available_modifiers: MenuItemModifierGroupModifierDB[]
  applied_modifiers: (MenuItemModifierGroupModifierDB & {
    ticket_menu_item_modifier_uuid: string
  })[]
  applied_promotions: ReturnPromotion[]
  modifier_group_amount_required?: number
}

export type ReturnCompleteTicket = {
  uuid: string
  id: number
  time_stamp: string
  status: TicketStatus
  location_group_uuid: string
  app_unique_uuid: string
  fulfillment_uuid: string
  guest_uuid: string
  guest_address_uuid: string
  table_uuid: string
  table_name?: string
  user_name: string
  first_name: string
  last_name: string
  email: string
  phone: string
  fulfillment_type: string
  address: string
  anonymous_address: string
  guests_points: number
  payment_uuid: string
  menu_items: ReturnMenuItem[]
  combos: ComboDB[]
  applied_promotions: ReturnPromotion[]
  eligable_promotions: ReturnPromotion[]
  ineligable_promotions: ReturnPromotion[]
  redeemed_points: number
  total_points: number
  end_points: number
  total_cents: number
  total: string
  tip_total: string
  tax_total: string
  tax_total_cents: number
  grand_total: string
  grand_total_cents: number
}
