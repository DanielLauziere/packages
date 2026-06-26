export declare function charsPerLineMM(widthMM: number): number;
export declare function wrapText(text: string, width: number): string[];
export declare function truncateText(text: string, width: number): string;
export declare function leftRight(left: string, right: string, width: number): string;
export declare function toAscii(text?: string | null): string;
export declare function formatAsciiDate(dateInput: string | number | Date): string;
export declare class EscPosBuilder {
    private chunks;
    private write;
    init(): void;
    build(): Uint8Array;
    raw(bytes: number[]): void;
    alignLeft(): void;
    alignCenter(): void;
    alignRight(): void;
    bold(on: boolean): void;
    text(str: string): void;
    feed(lines?: number): void;
    setTextSize(widthMultiplier: number, heightMultiplier: number): void;
    resetTextSize(): void;
    addRasterImage(width: number, height: number, pixels: Uint8Array): void;
    fullCut(): void;
    partialCut(): void;
    pulseDrawer(): void;
}
export declare function escposToBase64(data: Uint8Array): string;
export declare function sortByName<T extends {
    name: string;
}>(arr: T[]): T[];
export declare function scaleMatrix(matrix: number[][], target: number): Uint8Array;
export declare function rasterizeForEscPos(width: number, height: number, bitmap: Uint8Array): Uint8Array;
export declare function generateExact170pxQr(text: string): {
    width: number;
    height: number;
    pixels: Uint8Array<ArrayBuffer>;
};
export declare function addQrToReceipt(builder: EscPosBuilder, options?: {
    qrUrl?: string;
}): void;
export declare function resolvePrinterWidth(widthMM?: number): number;
export declare function safePrint(builder: EscPosBuilder, options?: {
    openDrawer?: boolean;
    extraFeedLines?: number;
    beepMode?: string;
}): Uint8Array;
interface TicketPrintModifier {
    name: string;
    priceWhole: number;
    priceHundredths: number;
}
interface TicketPrintPromotion {
    name?: string;
    type?: string;
    itemless?: boolean | number | null;
}
interface TicketPrintItem {
    uuid: string;
    name: string;
    priceWhole: number;
    priceHundredths: number;
    ticketMenuItemNote?: string | null;
    appliedModifiers?: TicketPrintModifier[];
    appliedPromotions?: TicketPrintPromotion[];
}
interface TicketPrintCombo {
    name: string;
    priceWhole: number;
    priceHundredths: number;
}
interface TicketPrintData {
    uuid?: string;
    id?: number | null;
    timeStamp: string;
    fulfillmentUuid?: string | null;
    fulfillmentType?: string | null;
    tableName?: string | null;
    guestAddressUuid?: string | null;
    address?: string;
    anonymousAddress?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    combos?: TicketPrintCombo[] | null;
    menuItems: TicketPrintItem[];
    appliedPromotions?: TicketPrintPromotion[] | null;
    guestsPoints?: number;
    totalPoints?: number;
    redeemedPoints?: number;
    endPoints?: number;
    total: string;
    taxTotal: string;
    tipTotal: string;
    grandTotal: string;
    grandTotalCents: number;
}
interface LocationPrintData {
    name?: string;
    address?: string | null;
    phone?: string | null;
    ticketDescription?: string | null;
    simplePrint?: boolean;
    printNotes?: boolean;
    features?: string[];
    taxPercentage?: number;
    tipPercentage?: number;
}
interface PaymentPrintData {
    uuid: string;
    priceWhole: number;
    priceHundredths: number;
}
export declare function ticketToEscPos(ticket: TicketPrintData, loc: LocationPrintData, options?: {
    lang?: 'es' | 'en';
    wrapMode?: 'wrap' | 'truncate';
    qrUrl?: string;
    receiptPrinterWidthMm?: number;
    openDrawer?: boolean;
    receiptPrinterHeightMm?: number;
    change?: boolean;
    payments?: PaymentPrintData[];
    ticketUpdate?: boolean;
    kitchenTicket?: boolean;
    beepMode?: string;
}): Promise<Uint8Array>;
export {};
//# sourceMappingURL=escpos.d.ts.map