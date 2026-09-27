import { weekColumnMonths } from './calendar'
import type { ProgramConnection, Work } from './types'

// クールは年と 0-3 のインデックス(0: 冬 / 1: 春 / 2: 夏 / 3: 秋)で表す
export interface Season {
  year: number
  index: number
}

const SEASON_SLUGS = ['winter', 'spring', 'summer', 'autumn']
const SEASON_LABELS = ['冬', '春', '夏', '秋']

export function seasonSlug(season: Season): string {
  return `${season.year}-${SEASON_SLUGS[season.index]}`
}

export function seasonLabel(season: Season): string {
  return `${season.year}年${SEASON_LABELS[season.index]}クール`
}

// 今クールを日本時間基準で判定する(1-3月: 冬 / 4-6月: 春 / 7-9月: 夏 / 10-12月: 秋)
export function getCurrentSeason(now: Date = new Date()): Season {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === 'year')!.value)
  const month = Number(parts.find((p) => p.type === 'month')!.value)
  return { year, index: Math.floor((month - 1) / 3) }
}

// delta クール分だけ前後に移動したクールを返す(年またぎ対応)
export function addSeasons(season: Season, delta: number): Season {
  const total = season.year * 4 + season.index + delta
  return { year: Math.floor(total / 4), index: ((total % 4) + 4) % 4 }
}

export function sameSeason(a: Season, b: Season): boolean {
  return a.year === b.year && a.index === b.index
}

// カレンダーに並ぶ 7 列の日付が属するクール(重複なし)。
// クールの変わり目の週は夏と秋のように 2 つ返るので、両方を読み込んで混在させる。
export function seasonsForWeek(now: Date = new Date()): Season[] {
  const seen = new Set<string>()
  const seasons: Season[] = []
  for (const { year, month } of weekColumnMonths(now)) {
    const season = { year, index: Math.floor((month - 1) / 3) }
    const key = seasonSlug(season)
    if (seen.has(key)) continue
    seen.add(key)
    seasons.push(season)
  }
  return seasons
}

// 複数クールをまとめた見出し。同じ年なら「2026年夏・秋クール」のように縮める
export function seasonsLabel(seasons: Season[]): string {
  if (seasons.length === 1) return seasonLabel(seasons[0])
  if (seasons.every((s) => s.year === seasons[0].year)) {
    return `${seasons[0].year}年${seasons.map((s) => SEASON_LABELS[s.index]).join('・')}クール`
  }
  return seasons.map(seasonLabel).join(' / ')
}

const QUERY = `
query SeasonWorks($seasons: [String!], $after: String) {
  searchWorks(
    seasons: $seasons
    orderBy: { field: WATCHERS_COUNT, direction: DESC }
    first: 50
    after: $after
  ) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      annictId
      title
      media
      officialSiteUrl
      # カードをクール別に淡く色分けするのに使う
      seasonName
      # 100件を超える作品は pageInfo から続きのページを取得する。
      programs(orderBy: { field: STARTED_AT, direction: DESC }, first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes {
          startedAt
          rebroadcast
          channel {
            annictId
            name
          }
        }
      }
    }
  }
}
`

interface SearchWorksResponse {
  data?: {
    searchWorks: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: (Work | null)[]
    }
  }
  errors?: { message: string }[]
}

interface MoreProgramsResponse {
  data?: Record<string, { nodes: ({ programs: ProgramConnection | null } | null)[] }>
  errors?: { message: string }[]
}

// 開発時は Vite のプロキシ経由(CORS 回避と挙動確認のため)、
// 本番ビルド(GitHub Pages などの静的ホスティング)では Annict API を直接呼ぶ
const GRAPHQL_ENDPOINT = import.meta.env.DEV ? '/graphql' : 'https://api.annict.com/graphql'

async function requestGraphql<T extends { errors?: { message: string }[] }>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    })
    if (res.status === 401) {
      throw new Error('認証に失敗しました。アクセストークンを確認してください。')
    }
    if (res.status === 429 && attempt < 4) {
      const retryAfter = Number(res.headers.get('Retry-After'))
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(1000 * 2 ** attempt, 8000)
      await new Promise((resolve) => setTimeout(resolve, delay))
      continue
    }
    if (!res.ok) throw new Error(`Annict API エラー (HTTP ${res.status})`)
    const json = await res.json() as T
    // GraphQL は HTTP 200 でも一部作品・配信予定が欠けることがある。
    if (json.errors?.length) throw new Error(`Annict API エラー: ${json.errors[0].message}`)
    return json
  }
  throw new Error('Annict API のリクエストを再試行できませんでした。')
}

// 複数作品の続きのページを GraphQL の別名で 1 リクエストにまとめる。
async function completePrograms(token: string, works: Work[]): Promise<void> {
  const pending = works.filter((work) =>
    (work.media === 'TV' || work.media === 'WEB') && work.programs?.pageInfo.hasNextPage,
  )
  const seenCursors = new Map<number, Set<string>>()
  while (pending.length > 0) {
    const batch = pending.splice(0, 5)
    const variables: Record<string, unknown> = {}
    const declarations: string[] = []
    const selections: string[] = []
    for (const [index, work] of batch.entries()) {
      const after = work.programs?.pageInfo.endCursor
      const seen = seenCursors.get(work.annictId) ?? new Set<string>()
      if (!after || seen.has(after)) {
        throw new Error(`Annict API のページングに失敗しました (${work.title})`)
      }
      seen.add(after)
      seenCursors.set(work.annictId, seen)
      variables[`id${index}`] = work.annictId
      variables[`after${index}`] = after
      declarations.push(`$id${index}: Int!, $after${index}: String!`)
      selections.push(`w${index}: searchWorks(annictIds: [$id${index}], first: 1) {
        nodes { programs(orderBy: { field: STARTED_AT, direction: DESC }, first: 100, after: $after${index}) {
          pageInfo { hasNextPage endCursor }
          nodes { startedAt rebroadcast channel { annictId name } }
        } }
      }`)
    }
    const query = `query MorePrograms(${declarations.join(', ')}) { ${selections.join('\n')} }`
    const json = await requestGraphql<MoreProgramsResponse>(token, query, variables)
    for (const [index, work] of batch.entries()) {
      const next = json.data?.[`w${index}`]?.nodes[0]?.programs
      if (!next || !work.programs) {
        throw new Error(`Annict API の配信予定を取得できませんでした (${work.title})`)
      }
      work.programs.nodes.push(...next.nodes)
      work.programs.pageInfo = next.pageInfo
      if (next.pageInfo.hasNextPage) pending.push(work)
    }
  }
}

// 今クールの作品と放送・配信予定を全件取得する(50件ずつページング)
export async function fetchSeasonWorks(token: string, seasonSlug: string): Promise<Work[]> {
  const works: Work[] = []
  let after: string | null = null

  const seenCursors = new Set<string>()
  while (true) {
    const json: SearchWorksResponse = await requestGraphql<SearchWorksResponse>(token, QUERY, { seasons: [seasonSlug], after })
    const search: NonNullable<SearchWorksResponse['data']>['searchWorks'] | undefined = json.data?.searchWorks
    if (!search) {
      throw new Error('Annict API から予期しない応答が返りました。')
    }

    const pageWorks: Work[] = []
    for (const work of search.nodes) {
      if (work) pageWorks.push(work)
    }
    await completePrograms(token, pageWorks)
    works.push(...pageWorks)
    if (!search.pageInfo.hasNextPage) break
    if (!search.pageInfo.endCursor || seenCursors.has(search.pageInfo.endCursor)) {
      throw new Error('Annict API の作品一覧のページングに失敗しました。')
    }
    seenCursors.add(search.pageInfo.endCursor)
    after = search.pageInfo.endCursor
  }

  return works
}

// 複数クールをまとめて取得する(クールの変わり目の週で夏と秋を混在させるため)。
// 同じ作品が両方のクールに登録されていることがあるので annictId で重複を除く。
export async function fetchWorksForSeasons(token: string, seasons: Season[]): Promise<Work[]> {
  const byId = new Map<number, Work>()
  for (const season of seasons) {
    for (const work of await fetchSeasonWorks(token, seasonSlug(season))) {
      if (!byId.has(work.annictId)) byId.set(work.annictId, work)
    }
  }
  return [...byId.values()]
}
