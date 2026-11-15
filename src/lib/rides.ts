import type { MapsPoint } from './googleMaps'

export type RideStatus = 'requested' | 'accepted' | 'driver_arriving' | 'driver_arrived' | 'in_progress' | 'completed' | 'rejected' | 'cancelled'
export type VehicleCategory = 'Mini' | 'Sedan' | 'SUV'
export type DriverProfile = {
  vehicleModel: string | null
  vehicleColor: string | null
  vehicleRegistration: string | null
  rating: number | null
  ratingCount: number
}
export type DriverLocation = {
  latitude: number
  longitude: number
  accuracyMeters: number | null
  headingDegrees: number | null
  speedMetersPerSecond: number | null
  recordedAt: number
  updatedAt: number
}
export type Ride = {
  id: string
  pickup: string
  destination: string
  pickupPoint: MapsPoint | null
  destinationPoint: MapsPoint | null
  routeDistanceMeters: number | null
  routeDurationSeconds: number | null
  estimatedFarePaise: number | null
  vehicle: VehicleCategory
  status: RideStatus
  riderName: string
  driver: (DriverProfile & { name: string; phone: string | null }) | null
  driverLocation: DriverLocation | null
  requestExpiresAt: number | null
  createdAt: string
  updatedAt: string
  acceptedAt: string | null
  driverArrivedAt: string | null
  startedAt: string | null
  completedAt: string | null
}

type DriverProfileInput = { vehicleModel: string; vehicleColor: string; vehicleRegistration: string }
type LocationInput = Omit<DriverLocation, 'updatedAt' | 'accuracyMeters' | 'headingDegrees' | 'speedMetersPerSecond'> & Partial<Pick<DriverLocation, 'accuracyMeters' | 'headingDegrees' | 'speedMetersPerSecond'>>

async function apiRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  let response: Response
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The server took too long to respond. Check your connection and refresh rides.')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => ({})) as { error?: string } & T
  if (!response.ok) throw new Error(data.error || 'Unable to update the ride. Please try again.')
  return data
}

export async function listRides(): Promise<Ride[]> {
  return (await apiRequest<{ rides: Ride[] }>('/api/rides')).rides
}

export async function createRide(data: {
  pickup: string
  destination: string
  vehicle: VehicleCategory
  pickupLat: number
  pickupLng: number
  destinationLat: number
  destinationLng: number
  routeDistanceMeters: number
  routeDurationSeconds: number
}): Promise<Ride> {
  return (await apiRequest<{ ride: Ride }>('/api/rides', 'POST', data)).ride
}

export type RideAction = 'accept' | 'reject' | 'cancel' | 'arriving' | 'arrived' | 'start' | 'complete'
export async function updateRide(id: string, action: RideAction): Promise<Ride> {
  return (await apiRequest<{ ride: Ride }>(`/api/rides/${encodeURIComponent(id)}/${action}`, 'POST', {})).ride
}

export async function getDriverProfile(): Promise<DriverProfile | null> {
  return (await apiRequest<{ profile: DriverProfile | null }>('/api/driver/profile')).profile
}

export async function saveDriverProfile(data: DriverProfileInput): Promise<DriverProfile> {
  return (await apiRequest<{ profile: DriverProfile }>('/api/driver/profile', 'PUT', data)).profile
}

export async function driverGoOnline(location: LocationInput): Promise<DriverLocation> {
  return (await apiRequest<{ location: DriverLocation }>('/api/driver/online', 'POST', location)).location
}

export async function driverGoOffline(): Promise<void> {
  await apiRequest('/api/driver/offline', 'POST', {})
}

export async function sendDriverLocation(location: LocationInput): Promise<DriverLocation> {
  return (await apiRequest<{ location: DriverLocation }>('/api/driver/location', 'POST', location)).location
}

export async function getDriverLocation(): Promise<{ online: boolean; location: DriverLocation | null }> {
  return apiRequest<{ online: boolean; location: DriverLocation | null }>('/api/driver/location')
}

export async function createShareLink(rideId: string): Promise<{ url: string; expiresAt: number }> {
  return apiRequest(`/api/rides/${encodeURIComponent(rideId)}/share`, 'POST', {})
}

export async function revokeShareLink(rideId: string): Promise<void> {
  await apiRequest(`/api/rides/${encodeURIComponent(rideId)}/share`, 'DELETE')
}

export type SharedTrip = Omit<Ride, 'id' | 'riderName' | 'driver' | 'driverLocation' | 'estimatedFarePaise' | 'acceptedAt' | 'driverArrivedAt' | 'startedAt' | 'completedAt'> & {
  driver: (DriverProfile & { name: string }) | null
  driverLocation: DriverLocation | null
}

export async function getSharedTrip(token: string): Promise<SharedTrip> {
  return (await apiRequest<{ trip: SharedTrip }>(`/api/share/${encodeURIComponent(token)}`)).trip
}
