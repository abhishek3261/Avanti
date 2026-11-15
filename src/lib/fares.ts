import type { VehicleCategory } from './rides'
import config from '../../shared/fare-config.json'

export type FareConfig = {
  baseFare: number
  perKmRate: number
  perMinuteRate: number
  bookingFee: number
  minimumFare: number
}

// Configurable Avanti demo rates in INR. These are sample values, not market quotes.
export const fareConfig = config as Record<VehicleCategory, FareConfig>

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
