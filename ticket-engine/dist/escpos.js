import qrcode from 'qrcode-generator';
// --------------------------------------------------
// CHAR WIDTH (MM VERSION)
// --------------------------------------------------
export function charsPerLineMM(widthMM) {
    return Math.floor(widthMM * 0.45);
}
// --------------------------------------------------
// TEXT HELPERS
// --------------------------------------------------
export function wrapText(text, width) {
    const words = text.split(/\s+/);
    const lines = [];
    let current = '';
    for (const w of words) {
        if ((current + ' ' + w).trim().length > width) {
            lines.push(current.trim());
            current = w;
        }
        else {
            current += ' ' + w;
        }
    }
    if (current.trim())
        lines.push(current.trim());
    return lines;
}
export function truncateText(text, width) {
    if (text.length <= width)
        return text;
    if (width <= 1)
        return text.slice(0, width);
    return text.slice(0, width - 1) + '…';
}
export function leftRight(left, right, width) {
    const space = width - (left.length + right.length);
    if (space < 1)
        return left;
    return left + ' '.repeat(space) + right;
}
export function toAscii(text) {
    if (!text)
        return '';
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x00-\x7F]/g, '');
}
export function formatAsciiDate(dateInput) {
    const d = new Date(dateInput);
    if (isNaN(d.getTime()))
        return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    if (hours === 0)
        hours = 12;
    return `${day}-${month}-${year} ${hours}:${minutes}:${seconds} ${ampm}`;
}
// --------------------------------------------------
// ESC/POS BUILDER
// --------------------------------------------------
export class EscPosBuilder {
    chunks = [];
    write(...bytes) {
        this.chunks.push(...bytes);
    }
    init() {
        this.write(0x1b, 0x40);
    }
    build() {
        return new Uint8Array(this.chunks);
    }
    raw(bytes) {
        this.write(...bytes);
    }
    alignLeft() {
        this.write(0x1b, 0x61, 0);
    }
    alignCenter() {
        this.write(0x1b, 0x61, 1);
    }
    alignRight() {
        this.write(0x1b, 0x61, 2);
    }
    bold(on) {
        this.write(0x1b, 0x45, on ? 1 : 0);
    }
    text(str) {
        const encoded = new TextEncoder().encode(str);
        this.chunks.push(...encoded, 0x0a);
    }
    feed(lines = 1) {
        this.write(0x1b, 0x64, lines);
    }
    setTextSize(widthMultiplier, heightMultiplier) {
        const w = Math.max(0, Math.min(7, widthMultiplier - 1));
        const h = Math.max(0, Math.min(7, heightMultiplier - 1));
        const size = (h << 4) | w;
        this.write(0x1d, 0x21, size);
    }
    resetTextSize() {
        this.write(0x1d, 0x21, 0x00);
    }
    addRasterImage(width, height, pixels) {
        const bytesPerRow = Math.ceil(width / 8);
        const totalBytes = bytesPerRow * height;
        this.write(0x1d, 0x76, 0x30, 0x00);
        this.write(bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff);
        this.write(height & 0xff, (height >> 8) & 0xff);
        for (let i = 0; i < totalBytes; i++) {
            this.chunks.push(pixels[i]);
        }
    }
    fullCut() {
        this.write(0x1d, 0x56, 0x00);
    }
    partialCut() {
        this.write(0x1d, 0x56, 0x01);
    }
    pulseDrawer() {
        this.write(0x1b, 0x70, 0x00, 0x19, 0xfa);
    }
}
export function escposToBase64(data) {
    return btoa(Array.from(data)
        .map((b) => String.fromCharCode(b))
        .join(''));
}
export function sortByName(arr) {
    return [...arr].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}
export function scaleMatrix(matrix, target) {
    const size = matrix.length;
    const scale = Math.floor(target / size);
    const out = new Uint8Array(target * target);
    let i = 0;
    for (let r = 0; r < target; r++) {
        for (let c = 0; c < target; c++) {
            const mr = Math.floor(r / scale);
            const mc = Math.floor(c / scale);
            out[i++] = matrix[mr][mc] === 1 ? 1 : 0;
        }
    }
    return out;
}
export function rasterizeForEscPos(width, height, bitmap) {
    const bytesPerRow = Math.ceil(width / 8);
    const out = new Uint8Array(bytesPerRow * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixel = bitmap[y * width + x];
            const byteIndex = y * bytesPerRow + (x >> 3);
            const bit = 7 - (x & 7);
            if (pixel)
                out[byteIndex] |= 1 << bit;
        }
    }
    return out;
}
export function generateExact170pxQr(text) {
    const version = 4;
    const errorCorrection = 'L';
    const qr = qrcode(version, errorCorrection);
    qr.addData(text);
    qr.make();
    const modules = qr.getModuleCount();
    const scale = 5;
    const pad = 0;
    const size = modules * scale + pad * 2;
    const bytesPerRow = Math.ceil(size / 8);
    const pixels = new Uint8Array(bytesPerRow * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const moduleX = Math.floor(x / scale);
            const moduleY = Math.floor(y / scale);
            const dark = qr.isDark(moduleY, moduleX);
            const byteIndex = y * bytesPerRow + (x >> 3);
            const bitIndex = 7 - (x & 7);
            if (dark) {
                pixels[byteIndex] |= 1 << bitIndex;
            }
        }
    }
    return {
        width: size,
        height: size,
        pixels,
    };
}
export function addQrToReceipt(builder, options) {
    if (!options?.qrUrl)
        return;
    const qr = generateExact170pxQr(options.qrUrl);
    builder.feed(1);
    builder.alignCenter();
    builder.addRasterImage(qr.width, qr.height, qr.pixels);
    builder.feed(1);
    builder.alignLeft();
}
// --------------------------------------------------
// PRINTER HELPERS (shared, no platform types)
// --------------------------------------------------
export function resolvePrinterWidth(widthMM) {
    if (!widthMM || widthMM <= 0) {
        return charsPerLineMM(80);
    }
    return charsPerLineMM(widthMM);
}
export function safePrint(builder, options) {
    const feedLines = options?.extraFeedLines ?? 6;
    builder.alignLeft();
    builder.feed(2);
    if (options?.openDrawer) {
        builder.pulseDrawer();
        builder.feed(2);
    }
    builder.feed(feedLines);
    if (options?.beepMode === 'bel') {
        builder.raw([0x07]);
    }
    if (options?.beepMode === 'escb') {
        builder.raw([0x1b, 0x42, 0x03, 0x03]);
    }
    builder.partialCut();
    return builder.build();
}
function toCents(cents) {
    return `0${cents}`.slice(-2);
}
// --------------------------------------------------
// TYPES for ticketToEscPos (shape, not platform enums)
// --------------------------------------------------
const FULFILLMENT_UUID_EATIN = 'ed345e57-4fb1-4111-8603-9c820417ed3e';
const FULFILLMENT_UUID_DELIVERY = '4294b886-85f4-45fa-9937-b74e7824b896';
const FULFILLMENT_UUID_CURBSIDE = '7ab17b56-2986-40d2-9b12-4093cdf594f6';
const FEATURE_LOYALTY_UUID = 'af09e433-e904-4925-b235-3dbe344e8fc0';
const PAYMENT_CARD_UUID = 'bc307676-fe8b-46e4-bad9-f35fab03ed90';
// --------------------------------------------------
// TRANSLATIONS
// --------------------------------------------------
function getTranslations(lang) {
    const es = [
        'Correo electrónico',
        'Mesa',
        '',
        'Domicilio',
        'Acera',
        'Dirección',
        'Puntos de invitado',
        'Puntos ganados',
        'Puntos usados',
        'Puntos totales',
        'Subtotal',
        'Impuesto',
        'Propina',
        'Total',
        'Tarjeta',
        'Cambio',
    ];
    const en = [
        'Email',
        'Table',
        '',
        'Delivery',
        'Curbside',
        'Address',
        'Guest points',
        'Points earned',
        'Points used',
        'Total points',
        'Subtotal',
        'Tax',
        'Tip',
        'Grand Total',
        'Card',
        'Change',
    ];
    return lang === 'en' ? en : es;
}
// --------------------------------------------------
// ticketToEscPos — UNIFIED
// --------------------------------------------------
export async function ticketToEscPos(ticket, loc, options) {
    const t = getTranslations(options?.lang);
    const builder = new EscPosBuilder();
    builder.init();
    function print(text) {
        builder.text(toAscii(text));
    }
    function leftRightExact(left, right) {
        const rightLen = right.length;
        const leftMax = width - rightLen;
        const leftFinal = left.length > leftMax ? left.slice(0, leftMax) : left;
        const spaces = width - (leftFinal.length + rightLen);
        return leftFinal + ' '.repeat(spaces) + right;
    }
    const width = resolvePrinterWidth(options?.receiptPrinterWidthMm);
    const grandTotalDollars = `$${ticket.grandTotal}`;
    const sortedCombos = sortByName(ticket.combos ?? []);
    const sortedMenuItems = sortByName(ticket.menuItems ?? []);
    const showTotal = (loc.taxPercentage ?? 0) > 0 ||
        (ticket.fulfillmentType === 'EATIN' && (loc.tipPercentage ?? 0) > 0);
    // ── HEADER ──
    builder.alignCenter();
    if (options?.kitchenTicket) {
        builder.feed(3);
    }
    if (options?.ticketUpdate) {
        builder.setTextSize(2, 2);
        builder.bold(true);
        print('ACTUALIZACIÓN DE RECIBO');
        builder.bold(false);
        builder.setTextSize(1, 1);
        builder.resetTextSize();
        builder.feed(1);
    }
    builder.setTextSize(1, 1);
    if (!options?.kitchenTicket) {
        print(loc.name);
    }
    builder.feed(1);
    builder.setTextSize(3, 3);
    builder.bold(true);
    print(grandTotalDollars);
    builder.feed(1);
    builder.bold(false);
    builder.resetTextSize();
    builder.setTextSize(1, 1);
    print(formatAsciiDate(ticket.timeStamp));
    // ── Fulfillment / Table header ──
    builder.alignCenter();
    builder.setTextSize(2.25, 2.25);
    builder.bold(true);
    switch (ticket.fulfillmentUuid) {
        case FULFILLMENT_UUID_EATIN: {
            if (ticket.tableName) {
                print(`${t[1]}: ${ticket.tableName}`);
            }
            else {
                print(t[1]);
            }
            break;
        }
        case FULFILLMENT_UUID_DELIVERY: {
            builder.setTextSize(1.75, 1.75);
            const addrParts = [];
            if (ticket.guestAddressUuid && ticket.address) {
                addrParts.push(ticket.address);
            }
            if (ticket.anonymousAddress) {
                addrParts.push(ticket.anonymousAddress);
            }
            if (addrParts.length > 0) {
                print(`${t[3]}: ${addrParts.join(' + ')}`);
            }
            else {
                print(t[3]);
            }
            break;
        }
        case FULFILLMENT_UUID_CURBSIDE: {
            print(t[4]);
            break;
        }
        default: {
            if (ticket.tableName) {
                print(`${t[1]}: ${ticket.tableName}`);
            }
            break;
        }
    }
    builder.bold(false);
    builder.resetTextSize();
    builder.setTextSize(1, 1);
    builder.alignLeft();
    builder.alignLeft();
    if (ticket.id != null)
        print(`# ${ticket.id}`);
    print('-'.repeat(width));
    if (ticket.firstName || ticket.lastName)
        print(`${ticket.firstName ?? ''} ${ticket.lastName ?? ''}`);
    if (ticket.phone)
        print(leftRightExact('Tel:', ticket.phone));
    if (ticket.email)
        print(leftRightExact(t[0], ticket.email));
    if (ticket.phone || ticket.email || ticket.firstName || ticket.lastName) {
        print('-'.repeat(width));
    }
    // ── KITCHEN TICKET ──
    if (options?.kitchenTicket) {
        if (ticket.combos?.length) {
            for (const combo of sortedCombos) {
                print(combo.name);
            }
            print('-'.repeat(width));
        }
        const grouped = new Map();
        for (const item of sortedMenuItems) {
            if (!grouped.has(item.uuid)) {
                grouped.set(item.uuid, {
                    name: item.name,
                    totalQty: 0,
                    notes: [],
                    modifiers: [],
                });
            }
            const group = grouped.get(item.uuid);
            group.totalQty += 1;
            if (item.ticketMenuItemNote) {
                group.notes.push(item.ticketMenuItemNote);
            }
            for (const mod of item.appliedModifiers ?? []) {
                group.modifiers.push(mod.name);
            }
        }
        for (const group of grouped.values()) {
            print(`${group.totalQty} ${group.name}`);
            for (const note of group.notes) {
                print(`  (${note})`);
            }
            const modCount = {};
            for (const name of group.modifiers) {
                modCount[name] = (modCount[name] ?? 0) + 1;
            }
            for (const [name, count] of Object.entries(modCount)) {
                print(`  (${count} ${name})`);
            }
        }
    }
    else {
        // ── CUSTOMER RECEIPT ──
        const simple = Boolean(loc.simplePrint);
        const shouldPrintNotes = Boolean(loc.printNotes);
        if (ticket.combos?.length) {
            for (const combo of sortedCombos) {
                const comboPrice = `$${combo.priceWhole}.${toCents(combo.priceHundredths)}`;
                print(leftRightExact(combo.name, comboPrice));
            }
            print('-'.repeat(width));
        }
        if (simple) {
            const grouped = new Map();
            for (const item of sortedMenuItems) {
                const unitPrice = item.priceWhole + item.priceHundredths / 100;
                if (!grouped.has(item.uuid)) {
                    grouped.set(item.uuid, {
                        name: item.name,
                        totalQty: 0,
                        unitPrice,
                        notes: [],
                        modifiers: [],
                        promotions: [],
                    });
                }
                const group = grouped.get(item.uuid);
                group.totalQty += 1;
                if (shouldPrintNotes && item.ticketMenuItemNote) {
                    group.notes.push(item.ticketMenuItemNote);
                }
                for (const mod of item.appliedModifiers ?? []) {
                    group.modifiers.push({
                        name: mod.name,
                        price: mod.priceWhole + mod.priceHundredths / 100,
                    });
                }
                for (const promo of item.appliedPromotions ?? []) {
                    if (promo.name && !group.promotions.includes(promo.name)) {
                        group.promotions.push(promo.name);
                    }
                }
            }
            for (const group of grouped.values()) {
                const total = group.totalQty * group.unitPrice;
                const left = `${group.totalQty} ${group.name}`;
                const right = `${group.totalQty > 1 ? ` x $${group.unitPrice.toFixed(2)} =` : ''} $${total.toFixed(2)}`;
                print(leftRightExact(left, right));
                const modCount = {};
                for (const mod of group.modifiers) {
                    if (!modCount[mod.name]) {
                        modCount[mod.name] = { qty: 0, price: mod.price };
                    }
                    modCount[mod.name].qty += 1;
                }
                for (const [name, data] of Object.entries(modCount)) {
                    const modTotal = data.qty * data.price;
                    const leftMod = `  ${data.qty} ${name}`;
                    const rightMod = data.price > 0
                        ? `${data.qty > 1 ? ` x $${data.price.toFixed(2)} =` : ''} $${modTotal.toFixed(2)}`
                        : '';
                    if (shouldPrintNotes || data.price !== 0) {
                        print(leftRightExact(leftMod, rightMod));
                    }
                }
                if (shouldPrintNotes) {
                    for (const note of group.notes) {
                        print(`  (${note})`);
                    }
                }
                for (const promo of group.promotions) {
                    print('');
                    print(`${promo}:`);
                }
            }
        }
        else {
            for (const item of sortedMenuItems) {
                for (const promo of item.appliedPromotions ?? []) {
                    builder.feed(1);
                    print(`${promo.name}:`);
                }
                const price = `$${(item.priceWhole + item.priceHundredths / 100).toFixed(2)}`;
                print(leftRightExact(item.name, price));
                if (shouldPrintNotes && item.ticketMenuItemNote) {
                    print(`  (${item.ticketMenuItemNote})`);
                }
                for (const mod of item.appliedModifiers ?? []) {
                    let modPrice = '';
                    const hasPrice = mod.priceHundredths !== 0 || mod.priceWhole !== 0;
                    if (hasPrice) {
                        modPrice = `$${(mod.priceWhole + mod.priceHundredths / 100).toFixed(2)}`;
                    }
                    if (shouldPrintNotes || hasPrice) {
                        print(leftRightExact(`  (${mod.name})`, modPrice));
                    }
                }
            }
        }
    }
    print('-'.repeat(width));
    // ── CUSTOMER-ONLY SECTION ──
    if (!options?.kitchenTicket) {
        // Rewards
        if (ticket.appliedPromotions) {
            const rewards = ticket.appliedPromotions.filter((p) => p.type === 'REWARD' && Boolean(p.itemless) === true);
            if (rewards.length) {
                for (const reward of rewards) {
                    print(reward.name ?? '');
                }
                print('-'.repeat(width));
            }
        }
        // Loyalty points
        if (loc.features?.includes(FEATURE_LOYALTY_UUID)) {
            print(leftRightExact(t[6], `${ticket.guestsPoints ?? 0}`));
            print(leftRightExact(t[7], `${ticket.totalPoints ?? 0}`));
            print(leftRightExact(t[8], `${ticket.redeemedPoints ?? 0}`));
            print(leftRightExact(t[9], `${ticket.endPoints ?? 0}`));
            print('-'.repeat(width));
        }
        // Totals
        builder.bold(true);
        if (showTotal) {
            print(leftRightExact(t[10], `$${ticket.total}`));
            if ((loc.taxPercentage ?? 0) > 0) {
                print(leftRightExact(t[11], `$${ticket.taxTotal}`));
            }
            if (ticket.fulfillmentType === 'EATIN' &&
                (loc.tipPercentage ?? 0) > 0) {
                print(leftRightExact(t[12], `$${ticket.tipTotal}`));
            }
        }
        print(leftRightExact(t[13], grandTotalDollars));
        print('-'.repeat(width));
        // Change + Payments
        if (options?.change && options.payments) {
            const payments = options.payments;
            let totalPayments = 0;
            for (const payment of payments) {
                const priceString = `$${(payment.priceWhole + payment.priceHundredths / 100).toFixed(2)}`;
                let paymentNameString = t[13];
                if (payment.uuid === PAYMENT_CARD_UUID) {
                    paymentNameString = t[14];
                }
                print(leftRightExact(paymentNameString, priceString));
                totalPayments += payment.priceWhole * 100 + payment.priceHundredths;
            }
            const change = totalPayments - ticket.grandTotalCents;
            const changeString = `$${(change / 100).toFixed(2)}`;
            print(leftRightExact(t[15], changeString));
        }
        builder.bold(false);
        // QR
        if (options?.qrUrl) {
            const qr = generateExact170pxQr(options.qrUrl);
            builder.feed(1);
            builder.alignCenter();
            builder.addRasterImage(qr.width, qr.height, qr.pixels);
            builder.feed(1);
            builder.alignLeft();
        }
        // Location
        builder.alignLeft();
        if (loc.address)
            print(leftRightExact(`${t[5]}:`, loc.address));
        if (loc.phone)
            print(leftRightExact('Tel:', loc.phone));
        builder.feed(1);
        if (loc.ticketDescription)
            print(loc.ticketDescription);
    }
    return safePrint(builder, {
        openDrawer: options?.openDrawer,
        extraFeedLines: 5,
        beepMode: options?.beepMode ?? 'none',
    });
}
//# sourceMappingURL=escpos.js.map