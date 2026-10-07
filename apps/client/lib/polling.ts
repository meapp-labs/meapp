import { create } from 'zustand'

export const useRealtimeStore = create<{
  active: boolean
  rooms: Record<string, boolean>
  setActive: (active: boolean) => void
  setRoomConnected: (roomId: string, connected: boolean) => void
}>((set) => ({
  active: true,
  rooms: {},
  setActive: (active) => set({ active }),
  setRoomConnected: (roomId, connected) =>
    set((state) => {
      const rooms = { ...state.rooms }
      if (connected) rooms[roomId] = true
      else delete rooms[roomId]
      return { rooms }
    }),
}))

export function pollingInterval(
  active: boolean,
  connected: boolean,
  interval: number,
): number | false {
  return active && !connected ? interval : false
}

/** Only room data with a matching authenticated subscription can skip polling. */
export function usePollingInterval(interval: number, roomId?: string): number | false {
  const active = useRealtimeStore((state) => state.active)
  const connected = useRealtimeStore((state) => Boolean(roomId && state.rooms[roomId]))
  return pollingInterval(active, connected, interval)
}
