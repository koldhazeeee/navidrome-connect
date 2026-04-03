import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSilentBlobUrl } from './silentAudio'

describe('createSilentBlobUrl', () => {
  let originalCreateObjectURL

  beforeEach(() => {
    originalCreateObjectURL = global.URL.createObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-silence')
  })

  afterEach(() => {
    global.URL.createObjectURL = originalCreateObjectURL
  })

  it('creates a one-second silent wav blob when duration is missing', () => {
    const result = createSilentBlobUrl(0)

    expect(result).toBe('blob:mock-silence')
    expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1)
    const blob = global.URL.createObjectURL.mock.calls[0][0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(8044)
  })

  it('scales the silent wav length to the requested duration', () => {
    createSilentBlobUrl(2.5)

    const blob = global.URL.createObjectURL.mock.calls[0][0]
    expect(blob.size).toBe(20044)
  })
})
