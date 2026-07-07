export interface Channel {
  annictId: number
  name: string
}

export interface Program {
  startedAt: string
  rebroadcast: boolean
  channel: Channel
}

export interface Work {
  annictId: number
  title: string
  media: 'TV' | 'OVA' | 'MOVIE' | 'WEB' | 'OTHER'
  officialSiteUrl: string | null
  programs: { nodes: (Program | null)[] } | null
  // 最古の配信(第1話の初配信)。最速配信の曜日を求めるのに使う。
  firstAired: { nodes: (Program | null)[] } | null
}
