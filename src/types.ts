export interface Channel {
  annictId: number
  name: string
}

export interface Program {
  startedAt: string
  rebroadcast: boolean
  channel: Channel
}

export type SeasonName = 'WINTER' | 'SPRING' | 'SUMMER' | 'AUTUMN'

export interface Work {
  annictId: number
  title: string
  media: 'TV' | 'OVA' | 'MOVIE' | 'WEB' | 'OTHER'
  officialSiteUrl: string | null
  // 作品が属するクール。未登録の作品では null になりうる
  seasonName: SeasonName | null
  programs: { nodes: (Program | null)[] } | null
  // 最古の配信(第1話の初配信)。最速配信の曜日を求めるのに使う。
  firstAired: { nodes: (Program | null)[] } | null
}
