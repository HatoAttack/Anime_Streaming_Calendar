import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSeasonWorks } from '../src/api'
import type { Program } from '../src/types'

afterEach(() => vi.unstubAllGlobals())

function program(name: string): Program {
  return { startedAt: '2026-09-28T12:00:00Z', rebroadcast: false, channel: { annictId: 1, name } }
}

function response(data: unknown): Response {
  return { ok: true, status: 200, json: async () => ({ data }) } as Response
}

describe('fetchSeasonWorks', () => {
  it('fetches programs beyond the first 100, including a streaming service at position 101', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ searchWorks: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{
          annictId: 1, title: '検証用', media: 'TV', officialSiteUrl: null, seasonName: 'AUTUMN',
          programs: { nodes: Array.from({ length: 100 }, () => program('テレビ局')), pageInfo: { hasNextPage: true, endCursor: 'cursor-100' } },
        }],
      } }))
      .mockResolvedValueOnce(response({ w0: {
        nodes: [{ programs: { nodes: [program('Netflix')], pageInfo: { hasNextPage: false, endCursor: null } } }],
      } }))
    vi.stubGlobal('fetch', fetchMock)

    const works = await fetchSeasonWorks('test-token', '2026-autumn')
    expect(works[0].programs?.nodes).toHaveLength(101)
    expect(works[0].programs?.nodes[100]?.channel.name).toBe('Netflix')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).variables).toEqual({ id0: 1, after0: 'cursor-100' })
  })

  it('batches additional pages for multiple works in one request', async () => {
    const initial = [1, 2].map((id) => ({
      annictId: id, title: `作品${id}`, media: 'TV', officialSiteUrl: null, seasonName: 'AUTUMN',
      programs: { nodes: [program('テレビ局')], pageInfo: { hasNextPage: true, endCursor: `cursor-${id}` } },
    }))
    const next = { nodes: [program('Netflix')], pageInfo: { hasNextPage: false, endCursor: null } }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ searchWorks: {
        pageInfo: { hasNextPage: false, endCursor: null }, nodes: initial,
      } }))
      .mockResolvedValueOnce(response({ w0: { nodes: [{ programs: next }] }, w1: { nodes: [{ programs: next }] } }))
    vi.stubGlobal('fetch', fetchMock)

    const works = await fetchSeasonWorks('test-token', '2026-autumn')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(works.map((work) => work.programs?.nodes.length)).toEqual([2, 2])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).variables).toEqual({
      id0: 1, after0: 'cursor-1', id1: 2, after1: 'cursor-2',
    })
  })

  it('follows work pages beyond the former ten-page limit', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const { variables } = JSON.parse(init.body)
      const page = variables.after === null ? 0 : Number(variables.after)
      return response({ searchWorks: {
        pageInfo: { hasNextPage: page < 10, endCursor: page < 10 ? String(page + 1) : null },
        nodes: [{
          annictId: page + 1, title: `作品${page}`, media: 'TV', officialSiteUrl: null, seasonName: 'AUTUMN',
          programs: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        }],
      } })
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchSeasonWorks('test-token', '2026-autumn')).toHaveLength(11)
    expect(fetchMock).toHaveBeenCalledTimes(11)
  })

  it('retries a rate-limited request', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ status: 429, headers: new Headers() })
        .mockResolvedValueOnce(response({ searchWorks: {
          pageInfo: { hasNextPage: false, endCursor: null }, nodes: [],
        } }))
      vi.stubGlobal('fetch', fetchMock)
      const result = fetchSeasonWorks('test-token', '2026-autumn')
      await vi.advanceTimersByTimeAsync(1000)
      expect(await result).toEqual([])
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns usable data and reports a partial GraphQL error', async () => {
    const onWarning = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        data: { searchWorks: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{
            annictId: 1, title: '検証用', media: 'TV', officialSiteUrl: null, seasonName: 'AUTUMN',
            programs: { nodes: [program('Netflix')], pageInfo: { hasNextPage: false, endCursor: null } },
          }],
        } },
        errors: [{ message: 'A partial field error' }],
      }),
    }))

    expect(await fetchSeasonWorks('test-token', '2026-autumn', onWarning)).toHaveLength(1)
    expect(onWarning).toHaveBeenCalledOnce()
  })

  it('keeps the fetched programs if a later program page has a field error', async () => {
    const onWarning = vi.fn()
    const firstPage = {
      annictId: 1, title: '検証用', media: 'TV', officialSiteUrl: null, seasonName: 'AUTUMN',
      programs: { nodes: [program('Netflix')], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ searchWorks: {
        pageInfo: { hasNextPage: false, endCursor: null }, nodes: [firstPage],
      } }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({
        data: { w0: { nodes: [null] } },
        errors: [{ message: 'A partial field error' }],
      }) })
    vi.stubGlobal('fetch', fetchMock)

    const works = await fetchSeasonWorks('test-token', '2026-autumn', onWarning)
    expect(works[0].programs?.nodes).toHaveLength(1)
    expect(onWarning).toHaveBeenCalledOnce()
  })
})
