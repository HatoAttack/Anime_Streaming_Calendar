import type { Work } from './types'
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

  const nowMs = now.getTime()

  for (const work of works) {
    if (work.media !== 'TV' && work.media !== 'WEB') continue

    // サービスごとに現在時刻へ最も近い配信予定を 1 件選ぶ
    const nearestByService = new Map<string, { service: StreamingService; startedAt: string; diff: number }>()
    for (const program of work.programs?.nodes ?? []) {
      if (!program || program.rebroadcast) continue
      const service = matchService(program.channel.name)
      if (!service) continue
      if (enabledServiceKeys && !enabledServiceKeys.has(service.key)) continue
      const diff = Math.abs(new Date(program.startedAt).getTime() - nowMs)
      const current = nearestByService.get(service.key)
      if (!current || diff < current.diff) {
        nearestByService.set(service.key, { service, startedAt: program.startedAt, diff })
      }
    }

    // 同じ曜日に配信されるサービスは 1 エントリにまとめる(時刻は最も早いもの)
    const byWeekday = new Map<number, { minutes: number; time: string; services: StreamingService[] }>()
    for (const { service, startedAt } of nearestByService.values()) {
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
        isLate: false,
      })
    }
  }

  for (const day of days) {
    day.entries.sort((a, b) => a.minutes - b.minutes || a.title.localeCompare(b.title, 'ja'))
  }

  // 週の左の列(昨日)から順に見て、2 回目以降に登場する作品を「遅れ配信」として畳む対象にする
  const seenWorkIds = new Set<number>()
  for (const day of days) {
    for (const entry of day.entries) {
      if (seenWorkIds.has(entry.workId)) {
        entry.isLate = true
      } else {
        seenWorkIds.add(entry.workId)
      }
    }
  }

  return days
}
