import React from 'react'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockNotify = vi.fn()
const mockHttpClient = vi.fn()
const mockClipboardWriteText = vi.fn()
const maskedAPIKeyValue = '************************'

vi.mock('react-admin', async () => {
  const actual = await vi.importActual('react-admin')
  return {
    ...actual,
    useNotify: () => mockNotify,
    useTranslate: () => (key) => key,
  }
})

vi.mock('../dataProvider', () => ({
  httpClient: (...args) => mockHttpClient(...args),
}))

import { UserAPIKeySection } from './UserAPIKeySection'

describe('UserAPIKeySection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClipboardWriteText.mockResolvedValue(undefined)
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      configurable: true,
    })
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockClipboardWriteText },
      configurable: true,
    })
    localStorage.clear()
  })

  it('keeps existing API keys hidden until the user regenerates them', async () => {
    mockHttpClient.mockResolvedValueOnce({
      json: { active: true },
    })

    const { container } = render(<UserAPIKeySection userId="user1" />)

    await waitFor(() => {
      expect(container.querySelector('.ra-input-APIKey input')).not.toBeNull()
    })
    const input = container.querySelector('.ra-input-APIKey input')
    expect(input.closest('.ra-input-APIKey')).toHaveClass('ra-input')
    expect(input.closest('.MuiInputBase-root')).toHaveClass(
      'MuiInputBase-marginDense',
      'MuiOutlinedInput-marginDense',
    )
    expect(input).toHaveValue(maskedAPIKeyValue)
    expect(
      screen.getByText('resources.user.actions.regenerateApiKey'),
    ).toBeTruthy()
    expect(screen.getByText('resources.user.actions.revokeApiKey')).toBeTruthy()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockHttpClient).toHaveBeenCalledWith('/api/user/user1/apikey')
  })

  it('revokes the active API key', async () => {
    localStorage.setItem('apiKey', 'active-api-key')
    mockHttpClient
      .mockResolvedValueOnce({
        json: { active: true },
      })
      .mockResolvedValueOnce({
        json: { active: false },
      })

    render(<UserAPIKeySection userId="user1" />)

    fireEvent.click(
      await screen.findByText('resources.user.actions.revokeApiKey'),
    )

    await waitFor(() => {
      expect(mockHttpClient).toHaveBeenCalledWith('/api/user/user1/apikey', {
        method: 'DELETE',
      })
      expect(localStorage.getItem('apiKey')).toBeNull()
      expect(
        screen.getByText('resources.user.actions.generateApiKey'),
      ).toBeTruthy()
      expect(mockNotify).toHaveBeenCalledWith(
        'resources.user.notifications.apiKeyRevoked',
        'info',
      )
    })
  })

  it('generates a new API key when none is active', async () => {
    mockHttpClient
      .mockResolvedValueOnce({
        json: { active: false },
      })
      .mockResolvedValueOnce({
        json: { apiKey: 'new-api-key', active: true },
      })

    const { container } = render(<UserAPIKeySection userId="user1" />)

    fireEvent.click(
      await screen.findByText('resources.user.actions.generateApiKey'),
    )

    await waitFor(() => {
      expect(mockHttpClient).toHaveBeenCalledWith('/api/user/user1/apikey', {
        method: 'POST',
      })
      expect(localStorage.getItem('apiKey')).toEqual('new-api-key')
      expect(mockNotify).toHaveBeenCalledWith(
        'resources.user.notifications.apiKeyGenerated',
        'info',
      )
    })

    const dialog = await screen.findByRole('dialog')
    const dialogInput = within(dialog).getByDisplayValue('new-api-key')
    fireEvent.click(dialogInput)

    await waitFor(() => {
      expect(mockClipboardWriteText).toHaveBeenCalledWith('new-api-key')
      expect(mockNotify).toHaveBeenCalledWith(
        'resources.user.notifications.apiKeyCopied',
        'info',
      )
    })

    fireEvent.click(within(dialog).getByText('ra.action.close'))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(container.querySelector('.ra-input-APIKey input')).toHaveValue(
        maskedAPIKeyValue,
      )
      expect(screen.queryByDisplayValue('new-api-key')).not.toBeInTheDocument()
      expect(
        screen.getByText('resources.user.actions.regenerateApiKey'),
      ).toBeTruthy()
    })
  })
})
