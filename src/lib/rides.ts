export type RideStatus = 'requested' | 'accepted' | 'declined' | 'cancelled'
export type VehicleCategory = 'Mini' | 'Sedan' | 'SUV'

export type Ride = {
  id: string
  pickup: string
  destination: string
  vehicle: VehicleCategory
  status: RideStatus
  riderName: string
  driverName: string | null
  createdAt: string
  updatedAt: string
}

async function apiRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({})) as { error?: string } & T
  if (!response.ok) throw new Error(data.error || 'Unable to update the ride. Please try again.')
  return data
}

export async function listRides(): Promise<Ride[]> {
  const result = await apiRequest<{ rides: Ride[] }>('/api/rides')
  return result.rides
}

export async function createRide(data: { pickup: string; destination: string; vehicle: VehicleCategory }): Promise<Ride> {
  const result = await apiRequest<{ ride: Ride }>('/api/rides', data)
  return result.ride
}

export async function updateRide(id: string, action: 'accept' | 'decline' | 'cancel'): Promise<Ride> {
  const result = await apiRequest<{ ride: Ride }>(`/api/rides/${encodeURIComponent(id)}/${action}`, {})
  return result.ride
}
