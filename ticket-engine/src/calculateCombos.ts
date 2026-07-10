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
  ticketMenuItems: TicketMenuItemDB[],
  comboComboMenuItems: ComboComboMenuItemDB[],
  menuItems: MenuItemDB[],
): [TicketMenuItemDB[], ComboDB[], number] {
  let totalCents = 0
  const comb: Comb[] = []

  for (const comboComboMenuItem of comboComboMenuItems) {
    const existsIndex = comb.findIndex(
      (c) => c.uuid === comboComboMenuItem.comboUuid,
    )

    if (existsIndex === -1) {
      comb.push({
        uuid: comboComboMenuItem.comboUuid,
        count: 1,
        items: [comboComboMenuItem.menuItemUuid],
      })
    } else {
      const existing = comb[existsIndex]
      if (existing)
        comb[existsIndex] = {
          uuid: existing.uuid,
          count: existing.count + 1,
          items: [...existing.items, comboComboMenuItem.menuItemUuid],
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
        const ticketItem = ticketMenuItems.find(
          (t) => t.menuItemUuid === comboItem,
        )
        if (!ticketItem) {
          hasComboItems = false
          break
        }
        deleteItems.push(ticketItem.uuid)
      }

      if (hasComboItems) {
        const comboMenuItems: ComboMenuItem[] = []

        for (const deleteUuid of deleteItems) {
          const index = ticketMenuItems.findIndex((t) => t.uuid === deleteUuid)
          if (index !== -1) {
            const ticketItem = ticketMenuItems[index]
            if (!ticketItem) continue
            const menuItem = menuItems.find(
              (m) => m.uuid === ticketItem.menuItemUuid,
            )
            if (menuItem) {
              comboMenuItems.push({
                uuid: ticketItem.uuid,
                menuItemCache: menuItem.cache,
                ticketUuid: ticketItem.ticketUuid,
                menuItemUuid: ticketItem.menuItemUuid,
                name: menuItem.name,
              })
            }
            ticketMenuItems.splice(index, 1)
          }
        }

        const comboCombo = comboComboMenuItems.find(
          (c) => c.uuid === combo.uuid,
        )
        if (comboCombo) {
          combos.push({
            uuid: comboCombo.uuid,
            name: comboCombo.name,
            description: comboCombo.description,
            active: comboCombo.active,
            priceWhole: comboCombo.priceWhole,
            priceHundredths: comboCombo.priceHundredths,
            comboMenuItems,
          })
          totalCents += comboCombo.priceWhole * 100 + comboCombo.priceHundredths
        }
      }
    }
  }

  return [ticketMenuItems, combos, totalCents]
}
