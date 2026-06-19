import { BogoMenuItemDB, ComboComboMenuItemDB, CompleteTicket, MenuItemDB, MenuItemModifierGroupModifierDB, PromotionDB, ReturnCompleteTicket, TableDB, TicketMenuItemDB, TicketMenuItemModifierDB, TicketPromotionDB } from './types.js';
export declare const calculateLocationTickets: ({ tickets, ticketMenuItems, menuItems, bogoMenuItems, ticketPromotions, promotions, tables, modifiers, ticketMenuItemsModifier, comboComboMenuItems, tipPercentage, taxPercentage, }: {
    tickets: CompleteTicket[];
    ticketMenuItems: TicketMenuItemDB[];
    menuItems: MenuItemDB[];
    bogoMenuItems: BogoMenuItemDB[];
    ticketPromotions: TicketPromotionDB[];
    promotions: PromotionDB[];
    tables: TableDB[];
    modifiers: MenuItemModifierGroupModifierDB[];
    ticketMenuItemsModifier: TicketMenuItemModifierDB[];
    comboComboMenuItems: ComboComboMenuItemDB[];
    tipPercentage: number;
    taxPercentage: number;
}) => ReturnCompleteTicket[];
//# sourceMappingURL=calculateLocationTickets.d.ts.map