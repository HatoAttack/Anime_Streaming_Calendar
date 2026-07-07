export interface Channel {
  annictId: number
  name: string
}

export interface Episode {
  annictId: number
}

export interface Program {
  startedAt: string
  rebroadcast: boolean
  channel: Channel
  // 同じエピソードは配信サービスをまたいで同一の annictId を共有する。
  // これを手がかりに各サービスの配信の早い/遅いを突き合わせる。null の場合あり。
  episode: Episode | null
}

export interface Work {
  annictId: number
  title: string
  media: 'TV' | 'OVA' | 'MOVIE' | 'WEB' | 'OTHER'
  officialSiteUrl: string | null
  programs: { nodes: (Program | null)[] } | null
}
