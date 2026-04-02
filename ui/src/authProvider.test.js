import { beforeEach, describe, expect, it, vi } from 'vitest'

const { baseUrl, jwtDecode, removeHomeCache } = vi.hoisted(() => ({
  baseUrl: vi.fn((path) => `http://localhost${path}`),
  jwtDecode: vi.fn(),
  removeHomeCache: vi.fn(),
}))

vi.mock('./config', () => ({
  default: {
    firstTime: false,
    baseURL: '',
    auth: null,
  },
}))

vi.mock('./utils', () => ({
  baseUrl,
}))

vi.mock('./utils/removeHomeCache', () => ({
  removeHomeCache,
}))

vi.mock('jwt-decode', () => ({
  jwtDecode,
}))

describe('authProvider', () => {
  beforeEach(() => {
    const storage = new Map()
    const localStorageMock = {
      getItem: vi.fn((key) => storage.get(key) ?? null),
      setItem: vi.fn((key, value) => storage.set(key, String(value))),
      removeItem: vi.fn((key) => storage.delete(key)),
      clear: vi.fn(() => storage.clear()),
    }

    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    })

    vi.resetModules()
    vi.clearAllMocks()
    localStorage.clear()
    global.fetch = vi.fn()
  })

  it('verifies the returned apiKey through tokenInfo during login', async () => {
    const loginResponse = {
      id: 'user-1',
      name: 'Admin',
      username: 'admin',
      isAdmin: true,
      apiKey: 'test-api-key',
      subsonicSalt: 'abc123',
      subsonicToken: 'token123',
      token: 'header.payload.signature',
    }
    const tokenInfoResponse = {
      'subsonic-response': {
        status: 'ok',
        tokenInfo: {
          username: 'admin',
        },
      },
    }

    global.fetch
      .mockResolvedValueOnce({
        status: 200,
        json: vi.fn().mockResolvedValue(loginResponse),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: vi.fn().mockResolvedValue(tokenInfoResponse),
      })

    const { default: authProvider } = await import('./authProvider')
    const response = await authProvider.login({
      username: 'admin',
      password: 'password',
    })

    expect(jwtDecode).toHaveBeenCalledWith(loginResponse.token)
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(global.fetch.mock.calls[1][0]).toContain('/rest/tokenInfo.view?')
    expect(global.fetch.mock.calls[1][0]).toContain('apiKey=test-api-key')
    expect(localStorage.getItem('apiKey')).toEqual('test-api-key')
    expect(localStorage.getItem('username')).toEqual('admin')
    expect(response).toEqual(loginResponse)
    expect(removeHomeCache).toHaveBeenCalled()
  })

  it('removes apiKey on logout', async () => {
    localStorage.setItem('apiKey', 'test-api-key')
    localStorage.setItem('is-authenticated', 'true')

    const { default: authProvider } = await import('./authProvider')
    await authProvider.logout()

    expect(localStorage.getItem('apiKey')).toBeNull()
    expect(localStorage.getItem('is-authenticated')).toBeNull()
  })
})
