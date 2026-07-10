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
  ticketMenuItems,
  menuItems,
  bogoMenuItems,
  ticketPromotions,
  promotions,
  tables,
  modifiers,
  ticketMenuItemsModifier,
  comboComboMenuItems,
  tipPercentage,
  taxPercentage,
}: {
  tickets: CompleteTicket[]
  ticketMenuItems: TicketMenuItemDB[]
  menuItems: MenuItemDB[]
  bogoMenuItems: BogoMenuItemDB[]
  ticketPromotions: TicketPromotionDB[]
  promotions: PromotionDB[]
  tables: TableDB[]
  modifiers: MenuItemModifierGroupModifierDB[]
  ticketMenuItemsModifier: TicketMenuItemModifierDB[]
  comboComboMenuItems: ComboComboMenuItemDB[]
  tipPercentage: number
  taxPercentage: number
}): ReturnCompleteTicket[] => {
  const returnTickets: ReturnCompleteTicket[] = []

  let multiplier = 0
  for (const promotion of promotions) {
    if (
      promotion.active &&
      promotion.type === 'LOYALTY' &&
      promotion.pointsMultiplier > multiplier
    ) {
      multiplier = promotion.pointsMultiplier
    }
  }

  for (const currentTicket of tickets) {
    let totalCents = 0

    const ticket: ReturnCompleteTicket = {
      uuid: currentTicket.uuid,
      id: currentTicket.id,
      timeStamp: currentTicket.timeStamp,
      status: currentTicket.status,
      locationGroupUuid: currentTicket.locationGroupUuid,
      locationUuid: currentTicket.locationUuid,
      appUniqueUuid: currentTicket.appUniqueUuid,
      fulfillmentUuid: currentTicket.fulfillmentUuid,
      guestUuid: currentTicket.guestUuid,
      guestAddressUuid: currentTicket.guestAddressUuid,
      tableUuid: currentTicket.tableUuid,
      userName: currentTicket.userName,
      firstName: currentTicket.firstName,
      lastName: currentTicket.lastName,
      email: currentTicket.email,
      phone: currentTicket.phone,
      fulfillmentType: currentTicket.fulfillmentType,
      address: currentTicket.address,
      anonymousAddress: currentTicket.anonymousAddress,
      guestsPoints: currentTicket.points || 0,
      paymentUuid: currentTicket.paymentUuid,
      menuItems: [],
      combos: [],
      appliedPromotions: [],
      eligablePromotions: [],
      ineligablePromotions: [],
      redeemedPoints: 0,
      totalPoints: 0,
      endPoints: 0,
      totalCents: 0,
      total: '0.00',
      tipTotal: '0.00',
      taxTotal: '0.00',
      taxTotalCents: 0,
      grandTotal: '0.00',
      grandTotalCents: 0,
    }

    if (currentTicket.tableUuid) {
      const table = tables.find((t) => t.uuid === currentTicket.tableUuid)
      if (table) ticket.tableName = table.name
    }

    const ticketItemsForThisTicket = ticketMenuItems.filter(
      (t) => t.ticketUuid === currentTicket.uuid,
    )

    const [remainingItems, combos, comboTotal] = calculateCombos(
      [...ticketItemsForThisTicket],
      comboComboMenuItems,
      menuItems,
    )

    ticket.combos = combos
    totalCents += comboTotal

    for (const tmi of remainingItems) {
      const menuItem = menuItems.find((mi) => mi.uuid === tmi.menuItemUuid)
      if (!menuItem) continue

      const returnMenuItem: ReturnMenuItem = {
        uuid: menuItem.uuid,
        cache: menuItem.cache,
        active: menuItem.active,
        name: menuItem.name,
        description: menuItem.description,
        priceWhole: menuItem.priceWhole,
        priceHundredths: menuItem.priceHundredths,
        originalPriceWhole: 0,
        originalPriceHundredths: 0,
        ticketMenuItemUuid: tmi.uuid,
        ticketMenuItemNote: tmi.note,
        availableModifiers: [],
        appliedModifiers: [],
        appliedPromotions: [],
      }

      for (const modifier of modifiers) {
        if (modifier.menuItemUuid !== menuItem.uuid) continue

        returnMenuItem.availableModifiers.push(modifier)
        returnMenuItem.modifierGroupAmountRequired = modifier.amountRequired

        for (const tm of ticketMenuItemsModifier) {
          if (
            tm.modifierUuid === modifier.uuid &&
            tm.ticketMenuItemUuid === tmi.uuid
          ) {
            const appliedModifier = {
              ...modifier,
              ticketMenuItemModifierUuid: tm.uuid,
            }

            returnMenuItem.appliedModifiers.push(appliedModifier)
            totalCents += modifier.priceWhole * 100 + modifier.priceHundredths
          }
        }
      }

      for (const tp of ticketPromotions) {
        if (tp.ticketMenuItemUuid !== tmi.uuid) continue

        const promotion = promotions.find((p) => p.uuid === tp.promotionUuid)
        if (!promotion) continue

        const promot: ReturnPromotion = { ...promotion }

        returnMenuItem.appliedPromotions.push(promot)
        ticket.appliedPromotions.push(promot)

        if (promot.type === 'PROMOTION' || promot.type === 'REWARD') {
          const cents = menuItem.priceWhole * 100 + menuItem.priceHundredths
          let discount = 0
          if (promot.promotionIsPercentage) {
            discount = Math.floor((cents * promot.discountPercent) / 100)
          } else {
            discount = promot.discountWhole * 100 + promot.discountHundredths
          }
          const final = cents - discount
          returnMenuItem.priceWhole = Math.floor(final / 100)
          returnMenuItem.priceHundredths = final % 100
        }
        returnMenuItem.originalPriceWhole = menuItem.priceWhole
        returnMenuItem.originalPriceHundredths = menuItem.priceHundredths
      }

      totalCents +=
        returnMenuItem.priceWhole * 100 + returnMenuItem.priceHundredths
      ticket.menuItems.push(returnMenuItem)
    }

    const itemlessDiscounts: number[] = []
    for (const tp of ticketPromotions) {
      if (tp.ticketMenuItemUuid) continue

      const promotion = promotions.find(
        (p) => p.uuid === tp.promotionUuid && p.type === 'REWARD' && p.itemless,
      )
      if (!promotion) continue

      const promot: ReturnPromotion = { ...promotion }
      ticket.appliedPromotions.push(promot)

      let discount: number
      if (promot.promotionIsPercentage) {
        discount = Math.floor((totalCents * promot.discountPercent) / 100)
      } else {
        discount = promot.discountWhole * 100 + promot.discountHundredths
      }
      totalCents -= discount
      itemlessDiscounts.push(discount)
    }

    for (const promo of ticket.appliedPromotions) {
      if (promo.type === 'REWARD') {
        ticket.redeemedPoints += promo.pointsRequired
      }
    }

    ticket.totalPoints = Math.floor((totalCents * multiplier) / 100)
    ticket.endPoints =
      ticket.guestsPoints - ticket.redeemedPoints + ticket.totalPoints
    ticket.totalCents = totalCents

    const format = (c: number) =>
      `${Math.floor(c / 100)}.${('0' + (c % 100)).slice(-2)}`
    ticket.total = format(totalCents)

    const tipCents = currentTicket.fulfillmentUuid === 'ed345e57-4fb1-4111-8603-9c820417ed3e'
      ? Math.floor((tipPercentage * totalCents) / 100)
      : 0
    ticket.tipTotal = format(tipCents)

    const taxCents = Math.floor(
      (taxPercentage * totalCents) / 100,
    )
    ticket.taxTotal = format(taxCents)
    ticket.taxTotalCents = taxCents

    let grandTotal = totalCents + tipCents + taxCents
    ticket.grandTotalCents = grandTotal
    ticket.grandTotal = format(grandTotal)

    // If discounts push grandTotal negative, remove itemless promotions one at a time until we recover
    if (grandTotal < 0) {
      const removeIndexes: number[] = []
      let discIdx = 0
      for (let i = 0; i < ticket.appliedPromotions.length; i++) {
        const p = ticket.appliedPromotions[i]!
        if (!p.itemless) continue
        totalCents += itemlessDiscounts[discIdx]
        discIdx++
        const recalcTip = ticket.fulfillmentUuid === 'ed345e57-4fb1-4111-8603-9c820417ed3e'
          ? Math.floor((tipPercentage * totalCents) / 100)
          : 0
        const recalcTax = Math.floor((taxPercentage * totalCents) / 100)
        grandTotal = totalCents + recalcTip + recalcTax
        removeIndexes.push(i)
        if (grandTotal >= 0) break
      }
      for (const idx of removeIndexes.reverse()) {
        ticket.appliedPromotions.splice(idx, 1)
      }
      // Recompute redeemedPoints from remaining promotions
      ticket.redeemedPoints = 0
      for (const promo of ticket.appliedPromotions) {
        if (promo.type === 'REWARD') {
          ticket.redeemedPoints += promo.pointsRequired
        }
      }
      // Recalculate
      ticket.totalPoints = Math.floor((totalCents * multiplier) / 100)
      ticket.endPoints = ticket.guestsPoints - ticket.redeemedPoints + ticket.totalPoints
      ticket.totalCents = totalCents
      ticket.total = format(totalCents)
      const newTipCents = ticket.fulfillmentUuid === 'ed345e57-4fb1-4111-8603-9c820417ed3e'
        ? Math.floor((tipPercentage * totalCents) / 100)
        : 0
      ticket.tipTotal = format(newTipCents)
      const newTaxCents = Math.floor((taxPercentage * totalCents) / 100)
      ticket.taxTotal = format(newTaxCents)
      ticket.taxTotalCents = newTaxCents
      grandTotal = totalCents + newTipCents + newTaxCents
      ticket.grandTotalCents = grandTotal
      ticket.grandTotal = format(grandTotal)
    }

    for (const promotion of promotions) {
      let eligable = false
      const promot: ReturnPromotion = { ...promotion }

      for (const bogo of bogoMenuItems) {
        if (
          bogo.bogoUuid === promotion.bogoBuy &&
          promotion.type === 'PROMOTION'
        ) {
          for (const mi of ticket.menuItems) {
            if (
              mi.uuid === bogo.menuItemUuid &&
              (mi.appliedPromotions.length === 0 ||
                mi.appliedPromotions[0]!.uuid !== promot.uuid)
            ) {
              eligable = true
              break
            }
          }
        }

        if (
          bogo.bogoUuid === promotion.bogoGet &&
          promotion.type === 'REWARD'
        ) {
          for (const mi of ticket.menuItems) {
            if (
              mi.uuid === bogo.menuItemUuid &&
              (mi.appliedPromotions.length === 0 ||
                mi.appliedPromotions[0]!.uuid !== promot.uuid) &&
              ticket.guestsPoints - ticket.redeemedPoints >=
                promotion.pointsRequired
            ) {
              eligable = true
              break
            }
          }
        }
      }

      if (promotion.type === 'REWARD' && promotion.itemless) {
        const discount = promot.discountWhole * 100 + promot.discountHundredths
        if (
          discount <= ticket.grandTotalCents &&
          ticket.guestsPoints - ticket.redeemedPoints >=
            promotion.pointsRequired
        ) {
          eligable = true
          for (const ap of ticket.appliedPromotions) {
            if (ap.uuid === promot.uuid) eligable = false
          }
        }
      }

      if (eligable && promotion.active) {
        ticket.eligablePromotions.push(promot)
      } else {
        ticket.ineligablePromotions.push(promot)
      }
    }

    returnTickets.push(ticket)
  }

  returnTickets.sort((a, b) => {
    const aName = a.tableName || ''
    const bName = b.tableName || ''
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
