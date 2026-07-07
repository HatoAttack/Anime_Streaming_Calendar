import type { Work } from './types'

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
      programs(orderBy: { field: STARTED_AT, direction: DESC }, first: 64) {
        nodes {
          startedAt
          rebroadcast
          channel {
            annictId
            name
          }
        }
      }
      # 最速配信の曜日を求めるための最古の配信(=第1話の初配信)。
      # Program.episode は Annict 上ほぼ null なのでエピソード単位の突き合わせは使えず、
      # 「一番早く配信した曜日=最速」という日付非依存のアンカーに用いる。
      firstAired: programs(orderBy: { field: STARTED_AT, direction: ASC }, first: 20) {
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

// 開発時は Vite のプロキシ経由(CORS 回避と挙動確認のため)、
// 本番ビルド(GitHub Pages などの静的ホスティング)では Annict API を直接呼ぶ
const GRAPHQL_ENDPOINT = import.meta.env.DEV ? '/graphql' : 'https://api.annict.com/graphql'

// 今クールの作品と放送・配信予定を全件取得する(50件ずつページング)
export async function fetchSeasonWorks(token: string, seasonSlug: string): Promise<Work[]> {
  const works: Work[] = []
  let after: string | null = null

  for (let page = 0; page < 10; page++) {
    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: QUERY, variables: { seasons: [seasonSlug], after } }),
    })

    if (res.status === 401) {
      throw new Error('認証に失敗しました。アクセストークンを確認してください。')
    }
    if (!res.ok) {
      throw new Error(`Annict API エラー (HTTP ${res.status})`)
    }

    const json: SearchWorksResponse = await res.json()
    const search = json.data?.searchWorks
    // データが取れていれば、フィールド単位のエラー(例: 非 null 制約違反)が混じっていても
    // 使える分で続行する。データが全く無いときだけ失敗扱いにする。
    if (!search) {
      throw new Error(
        json.errors?.length
          ? `Annict API エラー: ${json.errors[0].message}`
          : 'Annict API から予期しない応答が返りました。',
      )
    }
    if (json.errors?.length) {
      console.warn('Annict API から一部フィールドのエラーが返りました:', json.errors)
    }

    for (const work of search.nodes) {
      if (work) works.push(work)
    }
    if (!search.pageInfo.hasNextPage || !search.pageInfo.endCursor) break
    after = search.pageInfo.endCursor
  }

  return works
}
