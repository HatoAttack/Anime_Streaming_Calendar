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

  for (const work of works) {
    if (work.media !== 'TV' && work.media !== 'WEB') continue

    const programs = collectServicePrograms(work, enabledServiceKeys)
    if (programs.length === 0) continue

    const fastestWeekday = findFastestWeekday(programs)

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
  episodeId: number | null
}

// 作品の非再放送・対象サービスの配信予定を集める
function collectServicePrograms(
  work: Work,
  enabledServiceKeys: ReadonlySet<string> | null,
): ServiceProgram[] {
  const result: ServiceProgram[] = []
  for (const program of work.programs?.nodes ?? []) {
    if (!program || program.rebroadcast) continue
    const service = matchService(program.channel.name)
    if (!service) continue
    if (enabledServiceKeys && !enabledServiceKeys.has(service.key)) continue
    result.push({
      service,
      startedAt: program.startedAt,
      episodeId: program.episode?.annictId ?? null,
    })
  }
  return result
}

// 同じエピソードを各サービスがいつ配信したかを突き合わせ、
// 「常に最も早く配信するサービス(=最速)」の曜日を求める。
// この判定はチェックする曜日に依存しない。
function findFastestWeekday(programs: ServiceProgram[]): number | null {
  // エピソードごとの最速配信時刻(サービス横断)
  const earliestByEpisode = new Map<number, number>()
  for (const p of programs) {
    if (p.episodeId === null) continue
    const t = new Date(p.startedAt).getTime()
    const cur = earliestByEpisode.get(p.episodeId)
    if (cur === undefined || t < cur) earliestByEpisode.set(p.episodeId, t)
  }

  // サービスごとに、各エピソードの最速からの遅延(ミリ秒)を平均する。
  // 常に最速のサービスは遅延がほぼ 0 になる。
  const stats = new Map<string, { delaySum: number; count: number; latest: number }>()
  for (const p of programs) {
    const t = new Date(p.startedAt).getTime()
    const s = stats.get(p.service.key) ?? { delaySum: 0, count: 0, latest: -Infinity }
    if (p.episodeId !== null) {
      const earliest = earliestByEpisode.get(p.episodeId)
      if (earliest !== undefined) {
        s.delaySum += t - earliest
        s.count += 1
      }
    }
    if (t > s.latest) s.latest = t
    stats.set(p.service.key, s)
  }

  // 平均遅延が最小のサービスを最速とする。エピソード情報が無い場合は
  // 突き合わせできないので、代表(最新)配信が最も早い曜日にフォールバックする。
  let best: { key: string; avgDelay: number; latest: number } | null = null
  for (const [key, s] of stats) {
    const avgDelay = s.count > 0 ? s.delaySum / s.count : Number.POSITIVE_INFINITY
    if (
      best === null ||
      avgDelay < best.avgDelay ||
      (avgDelay === best.avgDelay && s.latest > best.latest)
    ) {
      best = { key, avgDelay, latest: s.latest }
    }
  }
  if (best === null) return null

  // エピソード突き合わせが全くできなかった場合のフォールバック:
  // 各サービス代表(最新配信)のうち、時刻が最も早い曜日を最速とみなす
  if (best.avgDelay === Number.POSITIVE_INFINITY) {
    const latestByService = new Map<string, number>()
    for (const p of programs) {
      const t = new Date(p.startedAt).getTime()
      const cur = latestByService.get(p.service.key)
      if (cur === undefined || t > cur) latestByService.set(p.service.key, t)
    }
    let fbWeekday: number | null = null
    let fbMinutes = Number.POSITIVE_INFINITY
    for (const t of latestByService.values()) {
      const { weekday, minutes } = jstInfo(new Date(t).toISOString())
      if (minutes < fbMinutes) {
        fbMinutes = minutes
        fbWeekday = weekday
      }
    }
    return fbWeekday
  }

  const { weekday } = jstInfo(new Date(best.latest).toISOString())
  return weekday
}
