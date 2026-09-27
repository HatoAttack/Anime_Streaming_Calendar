import { describe, expect, it } from 'vitest'
import { buildWeek } from '../src/calendar'
import type { Program, Work } from '../src/types'

const now = new Date('2026-09-28T03:00:00Z')

function program(startedAt: string, name: string): Program {
  return { startedAt, rebroadcast: false, channel: { annictId: 1, name } }
}

function work(programs: Program[]): Work {
  return {
    annictId: 1,
    title: '検証用',
    media: 'TV',
    officialSiteUrl: null,
    seasonName: 'AUTUMN',
    programs: { nodes: programs, pageInfo: { hasNextPage: false, endCursor: null } },
  }
}

describe('buildWeek', () => {
  it('does not treat the last registered schedule as the end of the series', () => {
    const days = buildWeek([work([program('2026-09-21T12:00:00Z', 'Netflix')])], null, now)
    expect(days.flatMap((day) => day.entries)).toHaveLength(1)
  })

  it('shows different times on the same weekday as separate entries', () => {
    const days = buildWeek([work([
      program('2026-09-29T14:00:00Z', 'Prime Video'),
      program('2026-09-28T15:00:00Z', 'Netflix'),
    ])], null, now)
    const tuesday = days.find((day) => day.dateLabel === '9/29')!
    expect(tuesday.entries.map((entry) => [entry.time, entry.services[0].key, entry.isLate])).toEqual([
      ['00:00', 'netflix', false],
      ['23:00', 'prime-video', true],
    ])
  })

  it('groups near-simultaneous services and shows their time range', () => {
    const days = buildWeek([work([
      program('2026-09-28T15:15:00Z', 'Netflix'),
      program('2026-09-28T15:30:00Z', 'Prime Video'),
      program('2026-09-28T16:00:00Z', 'ABEMA'),
    ])], null, now)
    const entries = days.find((day) => day.dateLabel === '9/29')!.entries
    expect(entries.map((entry) => [entry.time, entry.services.length, entry.isLate])).toEqual([
      ['00:15–00:30', 2, false],
      ['01:00', 1, true],
    ])
  })

  it('keeps the earlier slot on a day even when the later service first registered earlier', () => {
    const days = buildWeek([work([
      program('2026-09-28T16:30:00Z', 'ABEMA'),
      program('2026-07-01T16:30:00Z', 'ABEMA'),
      program('2026-09-28T15:00:00Z', 'Netflix'),
    ])], null, now)
    expect(days.find((day) => day.dateLabel === '9/29')!.entries.map((entry) => [entry.time, entry.isLate])).toEqual([
      ['00:00', false],
      ['01:30', true],
    ])
  })

  it('allows a short schedule gap but hides a service after fourteen days', () => {
    const recent = buildWeek([work([program('2026-09-14T12:00:00Z', 'Netflix')])], null, now)
    expect(recent.flatMap((day) => day.entries)).toHaveLength(1)
    const stale = buildWeek([work([program('2026-09-13T12:00:00Z', 'Netflix')])], null, now)
    expect(stale.flatMap((day) => day.entries)).toHaveLength(0)
  })

  it('keeps the true earliest slot when a simulcast crosses midnight', () => {
    const days = buildWeek([work([
      program('2026-09-28T16:00:00Z', 'Prime Video'),
      program('2026-09-28T14:00:00Z', 'Netflix'),
    ])], null, now)
    expect(days.flatMap((day) => day.entries.map((entry) => [day.dateLabel, entry.isLate]))).toEqual([
      ['9/28', false],
      ['9/29', true],
    ])
  })

  it('does not display a service before its first registered day', () => {
    const upcoming = buildWeek([work([program('2026-10-02T12:00:00Z', 'Netflix')])], null, now)
    expect(upcoming.flatMap((day) => day.entries.map((entry) => entry.premiereLabel))).toEqual(['10/2'])
    const later = buildWeek([work([program('2026-10-09T12:00:00Z', 'Netflix')])], null, now)
    expect(later.flatMap((day) => day.entries)).toHaveLength(0)
  })
})
