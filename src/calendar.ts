import type { Program, Work } from './types'
import { matchService, type StreamingService } from './services'

export interface CalendarEntry {
  workId: number
  title: string
  url: string
  time: string
  minutes: number
  services: StreamingService[]
  // 週の中で同じ作品がすでに早い曜日に登場している(=遅れ配信)場合 true
  isLate: boolean
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

// 昨日の曜日を先頭にした 7 日分のカレンダーを組み立てる。
// 各作品×配信サービスについて「現在時刻に最も近い配信予定」の曜日・時刻を採用するので、
// 取得済みの予定が週の前後にずれていても毎週の配信曜日として正しく表示される。
export function buildWeek(
  works: Work[],
  enabledServiceKeys: ReadonlySet<string> | null = null,
  now: Date = new Date(),
): DayColumn[] {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS)
  const todayUtcMidnight = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate())

  const days: DayColumn[] = []
  for (let offset = -1; offset <= 5; offset++) {
    const d = new Date(todayUtcMidnight + offset * DAY_MS)
    days.push({
      weekday: d.getUTCDay(),
      weekdayLabel: WEEKDAY_LABELS[d.getUTCDay()],
      dateLabel: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      isToday: offset === 0,
      entries: [],
    })
  }

  for (const work of works) {
    if (work.media !== 'TV' && work.media !== 'WEB') continue

    const programs = collectServicePrograms(work.programs, enabledServiceKeys)
    if (programs.length === 0) continue

    // 最速配信の曜日 = 第1話をいちばん早く配信した(=最古の配信の)曜日。
    // firstAired(最古の配信)から求め、無ければ表示用の配信の中の最古で代用する。
    const fastestWeekday = findFastestWeekday(
      collectServicePrograms(work.firstAired, enabledServiceKeys),
      programs,
    )

    // サービスごとの代表的な配信枠(曜日・時刻)を求める。週次で安定しているので
    // 最新の配信を代表に採る。同じ曜日に配信されるサービスは 1 エントリにまとめる。
    const repByService = new Map<string, { service: StreamingService; startedAt: string }>()
    for (const p of programs) {
      const cur = repByService.get(p.service.key)
      if (!cur || p.startedAt > cur.startedAt) {
        repByService.set(p.service.key, { service: p.service, startedAt: p.startedAt })
      }
    }

    const byWeekday = new Map<number, { minutes: number; time: string; services: StreamingService[] }>()
    for (const { service, startedAt } of repByService.values()) {
      const { weekday, minutes, time } = jstInfo(startedAt)
      const entry = byWeekday.get(weekday)
      if (!entry) {
        byWeekday.set(weekday, { minutes, time, services: [service] })
      } else {
        entry.services.push(service)
        if (minutes < entry.minutes) {
          entry.minutes = minutes
          entry.time = time
        }
      }
    }

    for (const [weekday, info] of byWeekday) {
      const column = days.find((d) => d.weekday === weekday)
      if (!column) continue
      column.entries.push({
        workId: work.annictId,
        title: work.title,
        url: work.officialSiteUrl || `https://annict.com/works/${work.annictId}`,
        time: info.time,
        minutes: info.minutes,
        services: info.services,
        // 最速配信の曜日以外はすべて遅れ配信(同一エピソードをより遅く配信するもの)
        isLate: fastestWeekday !== null && weekday !== fastestWeekday,
      })
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

// 最速配信の曜日を求める。第1話をいちばん早く配信した(=最古の配信の)曜日が最速。
// これはチェックする曜日に依存しない固定のアンカーになる。
// firstAired が空のときは表示用配信 fallbackPrograms の最古で代用する。
function findFastestWeekday(
  firstAired: ServiceProgram[],
  fallbackPrograms: ServiceProgram[],
): number | null {
  const source = firstAired.length > 0 ? firstAired : fallbackPrograms
  let earliest: number | null = null
  for (const p of source) {
    const t = new Date(p.startedAt).getTime()
    if (earliest === null || t < earliest) earliest = t
  }
  if (earliest === null) return null
  return jstInfo(new Date(earliest).toISOString()).weekday
}
