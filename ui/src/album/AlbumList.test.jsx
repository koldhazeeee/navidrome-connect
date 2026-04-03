import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AlbumList from './AlbumList'

const mockRefresh = vi.fn()
const mockLocation = vi.fn()

vi.mock('react-redux', () => ({
  useSelector: (selector) => selector({ albumView: { grid: false } }),
}))

vi.mock('react-router-dom', () => ({
  Redirect: ({ to }) => <div data-testid="redirect" data-to={to} />,
  useLocation: () => mockLocation(),
}))

vi.mock('react-admin', () => ({
  AutocompleteArrayInput: () => null,
  AutocompleteInput: () => null,
  Filter: ({ children }) => <>{children}</>,
  NullableBooleanInput: () => null,
  NumberInput: () => null,
  Pagination: () => null,
  ReferenceArrayInput: ({ children }) => <>{children}</>,
  ReferenceInput: ({ children }) => <>{children}</>,
  SearchInput: () => null,
  useListContext: () => ({ loading: false }),
  usePermissions: () => ({ permissions: 'admin' }),
  useRefresh: () => mockRefresh,
  useTranslate: () => (key) => key,
  useVersion: () => 1,
}))

vi.mock('@material-ui/core', () => ({
  withWidth: () => (Component) => Component,
}))

vi.mock('@material-ui/core/styles', () => ({
  makeStyles: () => () => ({ chip: {} }),
}))

vi.mock('../common', () => ({
  List: ({ children }) => <div>{children}</div>,
  QuickFilter: () => null,
  Title: () => null,
  useAlbumsPerPage: () => [25, [25, 50]],
  useResourceRefresh: () => {},
  useSetToggleableFields: () => {},
}))

vi.mock('./AlbumListActions', () => ({
  default: () => null,
}))

vi.mock('./AlbumTableView', () => ({
  default: () => null,
}))

vi.mock('./AlbumGridView', () => ({
  default: () => null,
}))

vi.mock('./AlbumInfo', () => ({
  default: () => null,
}))

vi.mock('../dialogs/ExpandInfoDialog', () => ({
  default: () => null,
}))

describe('<AlbumList />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocation.mockReturnValue({ pathname: '/album/random', search: '' })
    localStorage.clear()
  })

  it('does not refresh during render when redirecting to the random list route', () => {
    renderToString(<AlbumList width="md" />)

    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('refreshes after mount when redirecting to the random list route', async () => {
    render(<AlbumList width="md" />)

    expect(screen.getByTestId('redirect').getAttribute('data-to')).toBe(
      '/album/random?sort=random&order=ASC&filter={}',
    )
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
  })
})
