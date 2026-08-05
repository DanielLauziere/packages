import { calculateCombos } from './calculateCombos.js'
import {
  BogoMenuItemDB,
  ComboComboMenuItemDB,
  CompleteTicket,
  MenuItemDB,
  MenuItemModifierGroupModifierDB,
  PromotionDB,
  ReturnCompleteTicket,
  ReturnMenuItem,
  ReturnPromotion,
  TableDB,
  TicketMenuItemDB,
  TicketMenuItemModifierDB,
  TicketPromotionDB,
} from './types.js'

export const calculateLocationTickets = ({
  tickets,
  ticket_menu_items,
  menu_items,
  bogo_menu_items,
  ticketPromotions,
  promotions,
  tables,
  modifiers,
  ticketMenuItemsModifier,
  comboComboMenuItems,
  tip_percentage,
  tax_percentage,
}: {
  tickets: CompleteTicket[]
  ticket_menu_items: TicketMenuItemDB[]
  menu_items: MenuItemDB[]
  bogo_menu_items: BogoMenuItemDB[]
  ticketPromotions: TicketPromotionDB[]
  promotions: PromotionDB[]
  tables: TableDB[]
  modifiers: MenuItemModifierGroupModifierDB[]
  ticketMenuItemsModifier: TicketMenuItemModifierDB[]
  comboComboMenuItems: ComboComboMenuItemDB[]
  tip_percentage: number
  tax_percentage: number
}): ReturnCompleteTicket[] => {
  const returnTickets: ReturnCompleteTicket[] = []

  let multiplier = 0
  for (const promotion of promotions) {
    if (
      promotion.active &&
      promotion.type === 'LOYALTY' &&
      promotion.points_multiplier > multiplier
    ) {
      multiplier = promotion.points_multiplier
    }
  }

  for (const currentTicket of tickets) {
    let total_cents = 0

    const ticket: ReturnCompleteTicket = {
      uuid: currentTicket.uuid,
      id: currentTicket.id,
      time_stamp: currentTicket.time_stamp,
      status: currentTicket.status,
      location_group_uuid: currentTicket.location_group_uuid,
      locationUuid: currentTicket.locationUuid,
      app_unique_uuid: currentTicket.app_unique_uuid,
      fulfillment_uuid: currentTicket.fulfillment_uuid,
      guest_uuid: currentTicket.guest_uuid,
      guest_address_uuid: currentTicket.guest_address_uuid,
      table_uuid: currentTicket.table_uuid,
      user_name: currentTicket.user_name,
      first_name: currentTicket.first_name,
      last_name: currentTicket.last_name,
      email: currentTicket.email,
      phone: currentTicket.phone,
      fulfillment_type: currentTicket.fulfillment_type,
      address: currentTicket.address,
      anonymous_address: currentTicket.anonymous_address,
      guests_points: currentTicket.points || 0,
      payment_uuid: currentTicket.payment_uuid,
      menu_items: [],
      combos: [],
      applied_promotions: [],
      eligable_promotions: [],
      ineligable_promotions: [],
      redeemed_points: 0,
      total_points: 0,
      end_points: 0,
      total_cents: 0,
      total: '0.00',
      tip_total: '0.00',
      tax_total: '0.00',
      tax_total_cents: 0,
      grand_total: '0.00',
      grand_total_cents: 0,
    }

    if (currentTicket.table_uuid) {
      const table = tables.find((t) => t.uuid === currentTicket.table_uuid)
      if (table) ticket.table_name = table.name
    }

    const ticketItemsForThisTicket = ticket_menu_items.filter(
      (t) => t.ticket_uuid === currentTicket.uuid,
    )

    const [remainingItems, combos, comboTotal] = calculateCombos(
      [...ticketItemsForThisTicket],
      comboComboMenuItems,
      menu_items,
    )

    ticket.combos = combos
    total_cents += comboTotal

    for (const tmi of remainingItems) {
      const menu_item = menu_items.find((mi) => mi.uuid === tmi.menu_item_uuid)
      if (!menu_item) continue

      const returnMenuItem: ReturnMenuItem = {
        uuid: menu_item.uuid,
        cache: menu_item.cache,
        active: menu_item.active,
        name: menu_item.name,
        description: menu_item.description,
        price_whole: menu_item.price_whole,
        price_hundredths: menu_item.price_hundredths,
        original_price_whole: 0,
        original_price_hundredths: 0,
        ticket_menu_item_uuid: tmi.uuid,
        ticket_menu_item_note: tmi.note,
        available_modifiers: [],
        applied_modifiers: [],
        applied_promotions: [],
      }

      for (const modifier of modifiers) {
        if (modifier.menu_item_uuid !== menu_item.uuid) continue

        returnMenuItem.available_modifiers.push(modifier)
        returnMenuItem.modifier_group_amount_required = modifier.amount_required

        for (const tm of ticketMenuItemsModifier) {
          if (
            tm.modifier_uuid === modifier.uuid &&
            tm.ticket_menu_item_uuid === tmi.uuid
          ) {
            const appliedModifier = {
              ...modifier,
              ticket_menu_item_modifier_uuid: tm.uuid,
            }

            returnMenuItem.applied_modifiers.push(appliedModifier)
            total_cents += modifier.price_whole * 100 + modifier.price_hundredths
          }
        }
      }

      for (const tp of ticketPromotions) {
        if (tp.ticket_menu_item_uuid !== tmi.uuid) continue

        const promotion = promotions.find((p) => p.uuid === tp.promotion_uuid)
        if (!promotion) continue

        const promot: ReturnPromotion = { ...promotion }

        returnMenuItem.applied_promotions.push(promot)
        ticket.applied_promotions.push(promot)

        if (promot.type === 'PROMOTION' || promot.type === 'REWARD') {
          const cents = menu_item.price_whole * 100 + menu_item.price_hundredths
          let discount = 0
          if (promot.promotion_is_percentage) {
            discount = Math.floor((cents * promot.discount_percent) / 100)
          } else {
            discount = promot.discount_whole * 100 + promot.discount_hundredths
          }
          const final = cents - discount
          returnMenuItem.price_whole = Math.floor(final / 100)
          returnMenuItem.price_hundredths = final % 100
        }
        returnMenuItem.original_price_whole = menu_item.price_whole
        returnMenuItem.original_price_hundredths = menu_item.price_hundredths
      }

      total_cents +=
        returnMenuItem.price_whole * 100 + returnMenuItem.price_hundredths
      ticket.menu_items.push(returnMenuItem)
    }

    const itemlessDiscounts: number[] = []
    for (const tp of ticketPromotions) {
      if (tp.ticket_menu_item_uuid) continue

      const promotion = promotions.find(
        (p) => p.uuid === tp.promotion_uuid && p.type === 'REWARD' && p.itemless,
      )
      if (!promotion) continue

      const promot: ReturnPromotion = { ...promotion }
      ticket.applied_promotions.push(promot)

      let discount: number
      if (promot.promotion_is_percentage) {
        discount = Math.floor((total_cents * promot.discount_percent) / 100)
      } else {
        discount = promot.discount_whole * 100 + promot.discount_hundredths
      }
      total_cents -= discount
      itemlessDiscounts.push(discount)
    }

    for (const promo of ticket.applied_promotions) {
      if (promo.type === 'REWARD') {
        ticket.redeemed_points += promo.points_required
      }
    }

    ticket.total_points = Math.floor((total_cents * multiplier) / 100)
    ticket.end_points =
      ticket.guests_points - ticket.redeemed_points + ticket.total_points
    ticket.total_cents = total_cents

    const format = (c: number) =>
      `${Math.floor(c / 100)}.${('0' + (c % 100)).slice(-2)}`
    ticket.total = format(total_cents)

    const tipCents = currentTicket.fulfillment_uuid === 'ed345e57-4fb1-4111-8603-9c820417ed3e'
      ? Math.floor((tip_percentage * total_cents) / 100)
      : 0
    ticket.tip_total = format(tipCents)

    const taxCents = Math.floor(
      (tax_percentage * total_cents) / 100,
    )
    ticket.tax_total = format(taxCents)
    ticket.tax_total_cents = taxCents

    let grand_total = total_cents + tipCents + taxCents
    ticket.grand_total_cents = grand_total
    ticket.grand_total = format(grand_total)

    // If discounts push grand_total negative, remove itemless promotions one at a time until we recover
    if (grand_total < 0) {
      const removeIndexes: number[] = []
      let discIdx = 0
      for (let i = 0; i < ticket.applied_promotions.length; i++) {
        const p = ticket.applied_promotions[i]!
        if (!p.itemless) continue
        total_cents += itemlessDiscounts[discIdx]
        discIdx++
        const recalcTip = ticket.fulfillment_uuid === 'ed345e57-4fb1-4111-8603-9c820417ed3e'
          ? Math.floor((tip_percentage * total_cents) / 100)
          : 0
        const recalcTax = Math.floor((tax_percentage * total_cents) / 100)
        grand_total = total_cents + recalcTip + recalcTax
        removeIndexes.push(i)
        if (grand_total >= 0) break
      }
      for (const idx of removeIndexes.reverse()) {
        ticket.applied_promotions.splice(idx, 1)
      }
      // Recompute redeemed_points from remaining promotions
      ticket.redeemed_points = 0
      for (const promo of ticket.applied_promotions) {
        if (promo.type === 'REWARD') {
          ticket.redeemed_points += promo.points_required
        }
      }
      // Recalculate
      ticket.total_points = Math.floor((total_cents * multiplier) / 100)
      ticket.end_points = ticket.guests_points - ticket.redeemed_points + ticket.total_points
      ticket.total_cents = total_cents
      ticket.total = format(total_cents)
      const newTipCents = ticket.fulfillment_uuid === 'ed345e57-4fb1-4111-8603-9c820417ed3e'
        ? Math.floor((tip_percentage * total_cents) / 100)
        : 0
      ticket.tip_total = format(newTipCents)
      const newTaxCents = Math.floor((tax_percentage * total_cents) / 100)
      ticket.tax_total = format(newTaxCents)
      ticket.tax_total_cents = newTaxCents
      grand_total = total_cents + newTipCents + newTaxCents
      ticket.grand_total_cents = grand_total
      ticket.grand_total = format(grand_total)
    }

    for (const promotion of promotions) {
      let eligable = false
      const promot: ReturnPromotion = { ...promotion }

      for (const bogo of bogo_menu_items) {
        if (
          bogo.bogo_uuid === promotion.bogo_buy &&
          promotion.type === 'PROMOTION'
        ) {
          for (const mi of ticket.menu_items) {
            if (
              mi.uuid === bogo.menu_item_uuid &&
              (mi.applied_promotions.length === 0 ||
                mi.applied_promotions[0]!.uuid !== promot.uuid)
            ) {
              eligable = true
              break
            }
          }
        }

        if (
          bogo.bogo_uuid === promotion.bogo_get &&
          promotion.type === 'REWARD'
        ) {
          for (const mi of ticket.menu_items) {
            if (
              mi.uuid === bogo.menu_item_uuid &&
              (mi.applied_promotions.length === 0 ||
                mi.applied_promotions[0]!.uuid !== promot.uuid) &&
              ticket.guests_points - ticket.redeemed_points >=
                promotion.points_required
            ) {
              eligable = true
              break
            }
          }
        }
      }

      if (promotion.type === 'REWARD' && promotion.itemless) {
        const discount = promot.discount_whole * 100 + promot.discount_hundredths
        if (
          discount <= ticket.grand_total_cents &&
          ticket.guests_points - ticket.redeemed_points >=
            promotion.points_required
        ) {
          eligable = true
          for (const ap of ticket.applied_promotions) {
            if (ap.uuid === promot.uuid) eligable = false
          }
        }
      }

      if (eligable && promotion.active) {
        ticket.eligable_promotions.push(promot)
      } else {
        ticket.ineligable_promotions.push(promot)
      }
    }

    returnTickets.push(ticket)
  }

  returnTickets.sort((a, b) => {
    const aName = a.table_name || ''
    const bName = b.table_name || ''
    if (aName === '' && bName === '') return 0
    if (aName === '') return 1
    if (bName === '') return -1
    const ai = Number(aName)
    const bi = Number(bName)
    const aIsNum = !isNaN(ai)
    const bIsNum = !isNaN(bi)
    if (aIsNum && !bIsNum) return -1
    if (!aIsNum && bIsNum) return 1
    if (aIsNum && bIsNum) return ai - bi
    return aName.localeCompare(bName)
  })

  return returnTickets
}
