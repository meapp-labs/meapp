import { expect, it } from 'bun:test'
import { pollingInterval, useRealtimeStore } from './polling'

it('uses foreground polling only when the matching room lacks an authenticated socket', () => {
  expect(pollingInterval(false, false, 5000)).toBe(false)
  expect(pollingInterval(false, true, 5000)).toBe(false)
  expect(pollingInterval(true, true, 5000)).toBe(false)
  expect(pollingInterval(true, false, 5000)).toBe(5000)
  const store = useRealtimeStore.getState()
  store.setRoomConnected('one', true)
  expect(useRealtimeStore.getState().rooms.one).toBe(true)
  expect(useRealtimeStore.getState().rooms.two).toBeUndefined()
  store.setRoomConnected('one', false)
  expect(useRealtimeStore.getState().rooms.one).toBeUndefined()
})
