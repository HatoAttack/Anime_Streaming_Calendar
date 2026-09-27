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
  // 第1話(選択中サービスでの最速)の配信日。"10/1" 形式
  premiereLabel: string | null
  // その初回配信がまだ先(=これから始まる作品)かどうか
  isUpcoming: boolean
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
// 各作品×配信サービスについて「現在時刻に最も近い配信予定」の曜日・時刻を採用するので、
// 取得済みの予定が週の前後にずれていても毎週の配信曜日として正しく表示される。
// restrictToAiring が true のとき、各列の実際の日付にそのサービスが放送期間内である
// ものだけを載せる。まだ初回配信が来ていない作品(例: 10/1 開始は 10/1 の列から)も、
// すでに最終回を終えた作品(10 月の列に残る夏の終了作品)も落ちるので、クールをまたぐ
// 週でも列の日付どおりの内容になる。
// 今クール以外のプレビューでは全作品が放送期間外になるため、今クール表示のときだけ有効にする。
export function buildWeek(
  works: Work[],
  enabledServiceKeys: ReadonlySet<string> | null = null,
  now: Date = new Date(),
  restrictToAiring = true,
): DayColumn[] {
  const todayUtcMidnight = jstTodayMidnight(now)
  const nowShifted = now.getTime() + JST_OFFSET_MS

  const days: DayColumn[] = []
  // 曜日 → その列の実際の日付の開始/終端(JST、シフト座標系)。放送期間の判定に使う
  const columnStartByWeekday = new Map<number, number>()
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
    columnStartByWeekday.set(d.getUTCDay(), todayUtcMidnight + offset * DAY_MS)
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

    // 第1話をいちばん早く配信したサービス(=最速配信のサービス)。
    // 曜日ではなくサービスを覚えておき、表示する枠の中でそのサービスが出る曜日を最速とする。
    // 長期作品では firstAired(初回)と programs(直近の予定)で曜日がずれることがあるため。
    const fastestServiceKeys = findFastestServiceKeys(firstAired, programs)

    // サービスごとの初回/最終配信時刻(シフト座標系)。列の日付が放送期間内かの判定に使う
    const firstStartByService = new Map<string, number>()
    const lastStartByService = new Map<string, number>()
    for (const p of programs) {
      const t = new Date(p.startedAt).getTime() + JST_OFFSET_MS
      const first = firstStartByService.get(p.service.key)
      if (first === undefined || t < first) firstStartByService.set(p.service.key, t)
      const last = lastStartByService.get(p.service.key)
      if (last === undefined || t > last) lastStartByService.set(p.service.key, t)
    }

    // 第1話の最速配信日(選択中サービスの中でいちばん早い初回配信)
    let premiereMs: number | null = null
    for (const t of firstStartByService.values()) {
      if (premiereMs === null || t < premiereMs) premiereMs = t
    }
    const premiereDate = premiereMs === null ? null : new Date(premiereMs)
    const premiereLabel = premiereDate
      ? `${premiereDate.getUTCMonth() + 1}/${premiereDate.getUTCDate()}`
      : null
    const isUpcoming = premiereMs !== null && premiereMs > nowShifted

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
      // この曜日の列の実際の日付に、そのサービスが放送期間内かを見る。
      // 初回配信がその日より後なら「まだ始まっていない」、最終配信がその日より前なら
      // 「もう終わった」ので載せない。
      if (restrictToAiring) {
        const firstStart = firstStartByService.get(service.key)
        const lastStart = lastStartByService.get(service.key)
        const columnStart = columnStartByWeekday.get(weekday)
        const columnEnd = columnEndByWeekday.get(weekday)
        if (firstStart !== undefined && columnEnd !== undefined && firstStart >= columnEnd) continue
        if (lastStart !== undefined && columnStart !== undefined && lastStart < columnStart) continue
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

    // 表示する枠のうち、最速サービスが含まれる曜日が最速配信。
    // 最速サービスが表示枠に無い(未配信フィルタで落ちた等)場合は、残った枠の中で
    // いちばん早い時刻の曜日を最速とみなし、すべてが遅れ配信になるのを避ける。
    const fastestWeekday = pickFastestWeekday(byWeekday, fastestServiceKeys)

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
        premiereLabel,
        isUpcoming,
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

// 同時配信とみなす許容幅。第1話の最速から この時間内に配信したサービスは
// まとめて「最速サービス」として扱う(数分〜数十分の差で最速枠が割れないように)
const SIMULCAST_TOLERANCE_MS = 6 * 60 * 60 * 1000

// 第1話をいちばん早く配信したサービス群を求める。
// チェックする曜日に依存しない固定のアンカーになる。
// firstAired が空のときは表示用配信 fallbackPrograms の最古で代用する。
function findFastestServiceKeys(
  firstAired: ServiceProgram[],
  fallbackPrograms: ServiceProgram[],
): Set<string> {
  const source = firstAired.length > 0 ? firstAired : fallbackPrograms
  let earliest: number | null = null
  for (const p of source) {
    const t = new Date(p.startedAt).getTime()
    if (earliest === null || t < earliest) earliest = t
  }
  const keys = new Set<string>()
  if (earliest === null) return keys
  for (const p of source) {
    if (new Date(p.startedAt).getTime() <= earliest + SIMULCAST_TOLERANCE_MS) {
      keys.add(p.service.key)
    }
  }
  return keys
}

// 表示する曜日別の枠から最速配信の曜日を選ぶ。
// 最速サービスを含む曜日を優先し、無ければ最も早い時刻の曜日にフォールバックする。
function pickFastestWeekday(
  byWeekday: Map<number, { minutes: number; services: StreamingService[] }>,
  fastestServiceKeys: ReadonlySet<string>,
): number | null {
  let fallback: { weekday: number; minutes: number } | null = null
  for (const [weekday, info] of byWeekday) {
    if (info.services.some((s) => fastestServiceKeys.has(s.key))) return weekday
    if (fallback === null || info.minutes < fallback.minutes) {
      fallback = { weekday, minutes: info.minutes }
    }
  }
  return fallback?.weekday ?? null
}
