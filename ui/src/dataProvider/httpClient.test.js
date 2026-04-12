import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchJson = vi.fn()
const uuidv4 = vi.fn(() => 'generated-tab-id')
const removeHomeCache = vi.fn()
const jwtDecode = vi.fn(() => ({ uid: 'user-1' }))

vi.mock('react-admin', () => ({
  fetchUtils: {
    fetchJson,
  },
}))

vi.mock('uuid', () => ({
  v4: uuidv4,
}))

vi.mock('../utils', () => ({
  baseUrl: (url) => url,
}))

vi.mock('../utils/removeHomeCache', () => ({
  removeHomeCache,
}))

vi.mock('jwt-decode', () => ({
  jwtDecode,
}))

describe('httpClient', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    fetchJson.mockResolvedValue({
      headers: {
        get: () => null,
      },
    })
  })

  it('stores the client unique id in sessionStorage instead of localStorage', async () => {
    localStorage.setItem('clientUniqueId', 'shared-id')

    const { clientUniqueId } = await import('./httpClient')

    expect(clientUniqueId).toBe('generated-tab-id')
    expect(sessionStorage.getItem('clientUniqueId')).toBe('generated-tab-id')
    expect(localStorage.getItem('clientUniqueId')).toBe('shared-id')
  })

  it('sends the session-scoped client id header with requests', async () => {
    const { httpClient, clientUniqueId } = await import('./httpClient')

    await httpClient('/rest/ping.view')

    const [, options] = fetchJson.mock.calls[0]
    expect(options.headers.get('X-ND-Client-Unique-Id')).toBe(clientUniqueId)
  })
})
