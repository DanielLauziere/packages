// Shared billing types, constants, and logic used by both web and RN apps.

export interface PlanChange {
  uuid: string
  location_group_uuid: string
  new_monthly_price_cents: number
  effective_at: string
}

export interface Balance {
  balance_hundredths: number
  balance_whole: number
  add: boolean
  location_group_uuid: string
  time_stamp: string
  uuid: string
}

export interface BillingResponse {
  current_plan: string
  current_price_cents: number
  balance_cents: number
  plan_changes: PlanChange[]
  balances: Balance[]
}

export interface PlanChangePreview {
  new_plan: string
  new_price_cents: number
  days_remaining: number
  days_in_month: number
  current_plan_days_cost: number
  new_plan_days_cost: number
  net_cost_cents: number
}

export interface TimelineEvent {
  date: Date
  type: 'plan_change' | 'payment' | 'charge' | 'invoice'
  description: string
  amountCents?: number
}

export const PLAN_NAMES: Record<'starter' | 'restaurant' | 'enterprise', { en: string; es: string }> = {
  starter: { en: 'Starter', es: 'Básico' },
  restaurant: { en: 'Restaurant', es: 'Restaurante' },
  enterprise: { en: 'Enterprise', es: 'Empresarial' },
}

export const PLANS = [
  { key: 'starter', price: 1499, descriptionEn: 'For small restaurants', descriptionEs: 'Para restaurantes pequeños' },
  { key: 'restaurant', price: 3999, descriptionEn: 'For growing restaurants', descriptionEs: 'Para restaurantes en crecimiento' },
  { key: 'enterprise', price: 9999, descriptionEn: 'For restaurant chains', descriptionEs: 'Para cadenas de restaurantes' },
] as const

export function centsToDollar(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function getPlanLabel(priceCents: number, lang: string): string {
  if (priceCents <= 0) return lang === 'es' ? 'Sin plan' : 'No plan'
  if (priceCents <= 1499) return PLAN_NAMES.starter[lang as 'en' | 'es'] ?? 'Starter'
  if (priceCents <= 3999) return PLAN_NAMES.restaurant[lang as 'en' | 'es'] ?? 'Restaurant'
  return PLAN_NAMES.enterprise[lang as 'en' | 'es'] ?? 'Enterprise'
}

export function getActivePriceOnDate(planChanges: PlanChange[], date: Date): number {
  let price = 1499
  for (const pc of planChanges) {
    if (new Date(pc.effective_at) <= date) {
      price = pc.new_monthly_price_cents
    }
  }
  return price
}

export function generateMonthlyInvoices(
  planChanges: PlanChange[],
  balances: Balance[],
  lang: string,
  invoiceLabel: string,
  moLabel: string,
): TimelineEvent[] {
  if (planChanges.length === 0) return []

  const events: TimelineEvent[] = []
  const firstPlanChange = planChanges[0]
  if (!firstPlanChange) return []
  const activationDate = new Date(firstPlanChange.effective_at)
  const now = new Date()

  const payments = balances
    .filter((b) => b.add)
    .map((b) => ({
      date: new Date(b.time_stamp),
      amountCents: b.balance_whole * 100 + b.balance_hundredths,
    }))

  let cumulativeBalanceCents = 0
  let currentMonth = activationDate.getMonth()
  let currentYear = activationDate.getFullYear()

  while (currentYear < now.getFullYear() || (currentYear === now.getFullYear() && currentMonth <= now.getMonth())) {
    const monthDate = new Date(currentYear, currentMonth, 1)
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()

    let chargeCents = 0
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentYear, currentMonth, day)
      if (date < activationDate) continue
      const dailyPrice = getActivePriceOnDate(planChanges, date) / daysInMonth
      chargeCents += dailyPrice
    }

    if (chargeCents > 0) {
      cumulativeBalanceCents += chargeCents

      const invoiceDate = new Date(currentYear, currentMonth + 1, 1)
      const monthEndDate = new Date(currentYear, currentMonth + 1, 0)
      const monthPayments = payments.filter((p) => p.date >= monthDate && p.date <= monthEndDate)
      for (const payment of monthPayments) {
        cumulativeBalanceCents -= payment.amountCents
      }

      const monthName = monthDate.toLocaleDateString(lang === 'es' ? 'es-SV' : 'en-US', { month: 'long', year: 'numeric' })
      const labelPrice = getActivePriceOnDate(planChanges, monthEndDate)
      const planLabel = getPlanLabel(labelPrice, lang)
      events.push({
        date: invoiceDate,
        type: 'invoice',
        description: `${invoiceLabel} ${monthName} — ${planLabel} (${centsToDollar(labelPrice)}/${moLabel})`,
        amountCents: cumulativeBalanceCents,
      })
    }

    currentMonth++
    if (currentMonth > 11) {
      currentMonth = 0
      currentYear++
    }
  }

  return events
}

export function buildTimeline(
  billing: BillingResponse,
  lang: string,
  labels: {
    planActivated: string
    paymentReceived: string
    chargeMade: string
    invoiceFor: string
    mo: string
  },
): TimelineEvent[] {
  const events: TimelineEvent[] = []

  ;(billing.plan_changes ?? []).forEach((pc) => {
    const priceCents = pc.new_monthly_price_cents
    const stoppedLabel = lang === 'es' ? 'Facturación detenida' : 'Billing stopped'
    const description = priceCents <= 0
      ? `${stoppedLabel} (${centsToDollar(priceCents)}/${labels.mo})`
      : `${getPlanLabel(priceCents, lang)} ${labels.planActivated} (${centsToDollar(priceCents)}/${labels.mo})`
    events.push({
      date: new Date(pc.effective_at),
      type: 'plan_change',
      description,
      amountCents: priceCents,
    })
  })

  const invoiceEvents = generateMonthlyInvoices(
    billing.plan_changes ?? [],
    billing.balances ?? [],
    lang,
    labels.invoiceFor,
    labels.mo,
  )
  events.push(...invoiceEvents)

  billing?.balances?.forEach((b) => {
    const amountCents = b.balance_whole * 100 + b.balance_hundredths
    if (b.add) {
      events.push({
        date: new Date(b.time_stamp),
        type: 'payment',
        description: labels.paymentReceived,
        amountCents,
      })
    } else {
      events.push({
        date: new Date(b.time_stamp),
        type: 'charge',
        description: labels.chargeMade,
        amountCents: -amountCents,
      })
    }
  })

  events.sort((a, b) => a.date.getTime() - b.date.getTime())
  return events
}

export function formatDate(date: Date, lang: string): string {
  return date.toLocaleDateString(lang === 'es' ? 'es-SV' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
