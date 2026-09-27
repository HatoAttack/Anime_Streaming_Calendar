import type { Program, SeasonName, Work } from './types'
import { matchService, type StreamingService } from './services'

export interface CalendarEntry {
  workId: number
  title: string
  url: string
  time: string
  minutes: number
  services: StreamingService[]
  // 選択中サービスの初回配信がこの枠より早い場合 true
  isLate: boolean
  // 取得できた中で最初の配信日。"10/1" 形式
  premiereLabel: string | null
  // その初回配信がまだ先(=これから始まる作品)かどうか
  isUpcoming: boolean
  // 作品が属するクール。カードの淡い色分けに使う
  season: 'winter' | 'spring' | 'summer' | 'autumn' | null
}

export interface DayColumn {
  weekday: number
  weekdayLabel: string
  dateLabel: string
  isToday: boolean
  entries: CalendarEntry[]
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// UTC の ISO 文字列から日本時間の曜日と時刻を得る
function jstInfo(iso: string): { weekday: number; minutes: number; time: string } {
  const d = new Date(new Date(iso).getTime() + JST_OFFSET_MS)
  const hours = d.getUTCHours()
  const mins = d.getUTCMinutes()
  return {
    weekday: d.getUTCDay(),
    minutes: hours * 60 + mins,
    time: `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
  }
}

// 日本時間で「今日」の 0:00 をシフト座標(UTC の各フィールドが日本時間を表す)で返す
function jstTodayMidnight(now: Date): number {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS)
  return Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate())
}

// カレンダー 7 列それぞれの日本時間での年・月(1-12)。
// 列の日付がどのクールに属するかを判定するのに使う(週がクールをまたぐ移行期用)。
export function weekColumnMonths(now: Date = new Date()): { year: number; month: number }[] {
  const todayMidnight = jstTodayMidnight(now)
  const out: { year: number; month: number }[] = []
  for (let offset = -1; offset <= 5; offset++) {
    const d = new Date(todayMidnight + offset * DAY_MS)
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 })
  }
  return out
}

// 昨日の曜日を先頭にした 7 日分のカレンダーを組み立てる。
// 各作品×配信サービスについて最新の登録予定の曜日・時刻を代表枠に採用する。
// restrictToAiring が true のとき、列の日付より後に初配信するサービスは除外する。
// 登録済みの最後の予定は最終回とは限らないため、終了判定には使わない。
// 過去・未来クールのプレビューには初回前の判定を適用しない。
export function buildWeek(
  works: Work[],
  enabledServiceKeys: ReadonlySet<string> | null = null,
  now: Date = new Date(),
  restrictToAiring = true,
): DayColumn[] {
  const { days, columnEndByWeekday } = createWeekColumns(now)
  for (const work of works) {
    if (work.media !== 'TV' && work.media !== 'WEB') continue
    const programs = collectServicePrograms(work.programs, enabledServiceKeys)
    for (const { weekday, entry } of entriesForWork(work, programs, now, columnEndByWeekday, restrictToAiring)) {
      days.find((day) => day.weekday === weekday)?.entries.push(entry)
    }
  }

  for (const day of days) {
    day.entries.sort((a, b) => a.minutes - b.minutes || a.title.localeCompare(b.title, 'ja'))
  }

  return days
}

interface ServiceProgram {
  service: StreamingService
  startedAt: string
}

interface Slot {
  weekday: number
  minutes: number
  time: string
  services: StreamingService[]
}

function createWeekColumns(now: Date): {
  days: DayColumn[]
  columnEndByWeekday: Map<number, number>
} {
  const todayUtcMidnight = jstTodayMidnight(now)
  const days: DayColumn[] = []
  const columnEndByWeekday = new Map<number, number>()
  for (let offset = -1; offset <= 5; offset++) {
    const d = new Date(todayUtcMidnight + offset * DAY_MS)
    days.push({
      weekday: d.getUTCDay(),
      weekdayLabel: WEEKDAY_LABELS[d.getUTCDay()],
      dateLabel: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      isToday: offset === 0,
      entries: [],
    })
    columnEndByWeekday.set(d.getUTCDay(), todayUtcMidnight + (offset + 1) * DAY_MS)
  }
  return { days, columnEndByWeekday }
}

function firstStarts(programs: ServiceProgram[]): Map<string, number> {
  // Program.episode が欠ける予定もあるため、最古の登録予定を初回の推定値とする。
  const byService = new Map<string, number>()
  for (const p of programs) {
    const startedAt = new Date(p.startedAt).getTime() + JST_OFFSET_MS
    const first = byService.get(p.service.key)
    if (first === undefined || startedAt < first) byService.set(p.service.key, startedAt)
  }
  return byService
}

function groupSlots(
  programs: ServiceProgram[],
  firstStartByService: ReadonlyMap<string, number>,
  columnEndByWeekday: ReadonlyMap<number, number>,
  restrictToAiring: boolean,
): Map<string, Slot> {
  const latestByService = new Map<string, ServiceProgram>()
  for (const program of programs) {
    const current = latestByService.get(program.service.key)
    if (!current || program.startedAt > current.startedAt) latestByService.set(program.service.key, program)
  }

  const bySlot = new Map<string, Slot>()
  for (const { service, startedAt } of latestByService.values()) {
    const { weekday, minutes, time } = jstInfo(startedAt)
    const firstStart = firstStartByService.get(service.key)
    const columnEnd = columnEndByWeekday.get(weekday)
    if (restrictToAiring && firstStart !== undefined && columnEnd !== undefined && firstStart >= columnEnd) continue
    const key = `${weekday}:${minutes}`
    const slot = bySlot.get(key)
    if (slot) slot.services.push(service)
    else bySlot.set(key, { weekday, minutes, time, services: [service] })
  }
  return bySlot
}

function entriesForWork(
  work: Work,
  programs: ServiceProgram[],
  now: Date,
  columnEndByWeekday: ReadonlyMap<number, number>,
  restrictToAiring: boolean,
): { weekday: number; entry: CalendarEntry }[] {
  if (programs.length === 0) return []
  const firstStartByService = firstStarts(programs)
  const premiereMs = Math.min(...firstStartByService.values())
  const premiereDate = new Date(premiereMs)
  const premiereLabel = `${premiereDate.getUTCMonth() + 1}/${premiereDate.getUTCDate()}`
  const isUpcoming = premiereMs > now.getTime() + JST_OFFSET_MS
  const season = workSeason(work.seasonName, premiereDate)
  const bySlot = groupSlots(programs, firstStartByService, columnEndByWeekday, restrictToAiring)
  const fastestSlot = pickFastestSlot(bySlot, firstStartByService)
  return [...bySlot].map(([key, slot]) => ({
    weekday: slot.weekday,
    entry: {
      workId: work.annictId,
      title: work.title,
      url: work.officialSiteUrl || `https://annict.com/works/${work.annictId}`,
      time: slot.time,
      minutes: slot.minutes,
      services: slot.services,
      isLate: fastestSlot !== null && key !== fastestSlot,
      premiereLabel,
      isUpcoming,
      season,
    },
  }))
}

const SEASON_BY_NAME: Record<SeasonName, CalendarEntry['season']> = {
  WINTER: 'winter',
  SPRING: 'spring',
  SUMMER: 'summer',
  AUTUMN: 'autumn',
}

// 作品のクール。Annict の seasonName を使い、未登録なら初回配信月から補う
// (1-3月: 冬 / 4-6月: 春 / 7-9月: 夏 / 10-12月: 秋)
function workSeason(
  seasonName: SeasonName | null,
  premiereDate: Date | null,
): CalendarEntry['season'] {
  if (seasonName && SEASON_BY_NAME[seasonName]) return SEASON_BY_NAME[seasonName]
  if (!premiereDate) return null
  const order: CalendarEntry['season'][] = ['winter', 'spring', 'summer', 'autumn']
  return order[Math.floor(premiereDate.getUTCMonth() / 3)]
}

// 配信ノード列から、非再放送・対象サービスの配信予定を集める
function collectServicePrograms(
  connection: { nodes: (Program | null)[] } | null,
  enabledServiceKeys: ReadonlySet<string> | null,
): ServiceProgram[] {
  const result: ServiceProgram[] = []
  for (const program of connection?.nodes ?? []) {
    if (!program || program.rebroadcast) continue
    const service = matchService(program.channel.name)
    if (!service) continue
    if (enabledServiceKeys && !enabledServiceKeys.has(service.key)) continue
    result.push({ service, startedAt: program.startedAt })
  }
  return result
}

// 最古の配信時刻で比較する。曜日順や 00:00 をまたぐ時刻順には依存させない。
function pickFastestSlot(
  bySlot: Map<string, { services: StreamingService[] }>,
  firstStartByService: ReadonlyMap<string, number>,
): string | null {
  let fastest: { key: string; startedAt: number } | null = null
  for (const [key, info] of bySlot) {
    for (const service of info.services) {
      const startedAt = firstStartByService.get(service.key)
      if (startedAt !== undefined && (!fastest || startedAt < fastest.startedAt)) {
        fastest = { key, startedAt }
      }
    }
  }
  return fastest?.key ?? null
}
