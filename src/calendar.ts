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
// hideUnaired が true のとき、各列の実際の日付時点でまだ初回配信が来ていない
// サービスはその列に載せない(例: 7/19 初配信の作品は日曜列が 7/19 になる週から表示)。
// 来クールのプレビューでは全作品が未配信になるため、今クール表示のときだけ有効にする。
export function buildWeek(
  works: Work[],
  enabledServiceKeys: ReadonlySet<string> | null = null,
  now: Date = new Date(),
  hideUnaired = true,
): DayColumn[] {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS)
  const todayUtcMidnight = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate())

  const days: DayColumn[] = []
  // 曜日 → その列の実際の日付の終端(JST、シフト座標系)。未配信判定に使う
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

  for (const work of works) {
    if (work.media !== 'TV' && work.media !== 'WEB') continue

    // programs(新しい順の窓)と firstAired(古い順の窓)の両方から配信予定を集める。
    // 全国ネットの作品では firstAired の窓が初回放送日のテレビ局だけで埋まり、直後の
    // 配信サービスの初回配信を取りこぼすことがある。取りこぼすと下の firstStartByService が
    // 実際の初回配信日を拾えず、hideUnaired が全サービスを「まだ放送前」と誤判定して作品ごと
    // 消してしまう。どちらの窓にでも配信予定があれば拾えるようマージして扱う。
    const latestPrograms = collectServicePrograms(work.programs, enabledServiceKeys)
    const firstAired = collectServicePrograms(work.firstAired, enabledServiceKeys)
    const programs = [...latestPrograms, ...firstAired]
    if (programs.length === 0) continue

    // 最速配信の曜日 = 第1話をいちばん早く配信した(=最古の配信の)曜日。
    // firstAired(最古の配信)から求め、無ければ表示用の配信の中の最古で代用する。
    const fastestWeekday = findFastestWeekday(firstAired, programs)

    // サービスごとの初回配信時刻(シフト座標系)。列の日付時点で未配信かの判定に使う
    const firstStartByService = new Map<string, number>()
    for (const p of programs) {
      const t = new Date(p.startedAt).getTime() + JST_OFFSET_MS
      const cur = firstStartByService.get(p.service.key)
      if (cur === undefined || t < cur) firstStartByService.set(p.service.key, t)
    }

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
      // この曜日の列の実際の日付が終わるまでに初回配信が来ていなければ、まだ載せない
      if (hideUnaired) {
        const firstStart = firstStartByService.get(service.key)
        const columnEnd = columnEndByWeekday.get(weekday)
        if (firstStart !== undefined && columnEnd !== undefined && firstStart >= columnEnd) continue
      }
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
