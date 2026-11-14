import type { VehicleCategory } from './rides'

export type FareConfig = {
  baseFare: number
  perKmRate: number
  perMinuteRate: number
  bookingFee: number
  minimumFare: number
}

// Configurable Avanti demo rates in INR. These are sample values, not market quotes.
export const fareConfig: Record<VehicleCategory, FareConfig> = {
  Mini: { baseFare: 45, perKmRate: 13, perMinuteRate: 1.5, bookingFee: 12, minimumFare: 80 },
  Sedan: { baseFare: 65, perKmRate: 17, perMinuteRate: 2, bookingFee: 16, minimumFare: 115 },
  SUV: { baseFare: 90, perKmRate: 22, perMinuteRate: 2.5, bookingFee: 20, minimumFare: 160 },
}

export type FareEstimate = {
  baseFare: number
  distanceCharge: number
  timeCharge: number
  bookingFee: number
  subtotal: number
  minimumFareApplied: boolean
  adjustment: number
  total: number
}

export function calculateFare(vehicle: VehicleCategory, distanceMeters: number, durationMillis: number): FareEstimate {
  const config = fareConfig[vehicle]
  const distanceCharge = Math.round(distanceMeters / 1000 * config.perKmRate * 100) / 100
  const timeCharge = Math.round(durationMillis / 60_000 * config.perMinuteRate * 100) / 100
  const subtotal = config.baseFare + distanceCharge + timeCharge + config.bookingFee
  const total = Math.max(config.minimumFare, Math.round(subtotal))
  return {
    baseFare: config.baseFare,
    distanceCharge,
    timeCharge,
    bookingFee: config.bookingFee,
    subtotal,
    minimumFareApplied: total === config.minimumFare && subtotal < config.minimumFare,
    adjustment: Math.round((total - subtotal) * 100) / 100,
    total,
  }
}
