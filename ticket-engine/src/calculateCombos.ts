import {
  ComboComboMenuItemDB,
  ComboDB,
  ComboMenuItem,
  MenuItemDB,
  TicketMenuItemDB,
} from './types.js'

type Comb = {
  uuid: string
  items: string[]
  count: number
}

export function calculateCombos(
  ticket_menu_items: TicketMenuItemDB[],
  comboComboMenuItems: ComboComboMenuItemDB[],
  menu_items: MenuItemDB[],
): [TicketMenuItemDB[], ComboDB[], number] {
  let total_cents = 0
  const comb: Comb[] = []

  for (const comboComboMenuItem of comboComboMenuItems) {
    const existsIndex = comb.findIndex(
      (c) => c.uuid === comboComboMenuItem.combo_uuid,
    )

    if (existsIndex === -1) {
      comb.push({
        uuid: comboComboMenuItem.combo_uuid,
        count: 1,
        items: [comboComboMenuItem.menu_item_uuid],
      })
    } else {
      const existing = comb[existsIndex]
      if (existing)
        comb[existsIndex] = {
          uuid: existing.uuid,
          count: existing.count + 1,
          items: [...existing.items, comboComboMenuItem.menu_item_uuid],
        }
    }
  }

  comb.sort((a, b) => {
    if (a.count === b.count) {
      return b.uuid.localeCompare(a.uuid)
    }
    return b.count - a.count
  })

  const combos: ComboDB[] = []

  for (const combo of comb) {
    let hasComboItems = true

    while (hasComboItems) {
      hasComboItems = true
      const deleteItems: string[] = []

      for (const comboItem of combo.items) {
        const ticketItem = ticket_menu_items.find(
          (t) => t.menu_item_uuid === comboItem,
        )
        if (!ticketItem) {
          hasComboItems = false
          break
        }
        deleteItems.push(ticketItem.uuid)
      }

      if (hasComboItems) {
        const combo_menu_items: ComboMenuItem[] = []

        for (const deleteUuid of deleteItems) {
          const index = ticket_menu_items.findIndex((t) => t.uuid === deleteUuid)
          if (index !== -1) {
            const ticketItem = ticket_menu_items[index]
            if (!ticketItem) continue
            const menu_item = menu_items.find(
              (m) => m.uuid === ticketItem.menu_item_uuid,
            )
            if (menu_item) {
              combo_menu_items.push({
                uuid: ticketItem.uuid,
                menu_item_cache: menu_item.cache,
                ticket_uuid: ticketItem.ticket_uuid,
                menu_item_uuid: ticketItem.menu_item_uuid,
                name: menu_item.name,
              })
            }
            ticket_menu_items.splice(index, 1)
          }
        }

        const comboCombo = comboComboMenuItems.find(
          (c) => c.combo_uuid === combo.uuid,
        )
        if (comboCombo) {
          combos.push({
            uuid: comboCombo.uuid,
            name: comboCombo.name,
            description: comboCombo.description,
            active: comboCombo.active,
            price_whole: comboCombo.price_whole,
            price_hundredths: comboCombo.price_hundredths,
            combo_menu_items,
          })
          total_cents += comboCombo.price_whole * 100 + comboCombo.price_hundredths
        }
      }
    }
  }

  return [ticket_menu_items, combos, total_cents]
}
