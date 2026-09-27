export interface Channel {
  annictId: number
  name: string
}

export interface Program {
  startedAt: string
  rebroadcast: boolean
  channel: Channel
}

export interface ProgramConnection {
  nodes: (Program | null)[]
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
}

export type SeasonName = 'WINTER' | 'SPRING' | 'SUMMER' | 'AUTUMN'

export interface Work {
  annictId: number
  title: string
  media: 'TV' | 'OVA' | 'MOVIE' | 'WEB' | 'OTHER'
  officialSiteUrl: string | null
  // 作品が属するクール。未登録の作品では null になりうる
  seasonName: SeasonName | null
  programs: ProgramConnection | null
}
