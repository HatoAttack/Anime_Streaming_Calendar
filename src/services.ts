// Annict のチャンネル名 → 動画配信ストリーミングサービスの対応表。
// テレビ局などここに載っていないチャンネルの放送予定はカレンダーに表示しない。
export interface StreamingService {
  key: string
  label: string
  domain: string
  keywords: string[]
  // 作品タイトルをそのサービス内で検索するページの URL を組み立てる。
  // 各サービスの検索 URL は実機で HTTP ステータス・着地先を確認済み。
  // 未指定のサービス(サイト内検索リンクが不確実なもの)は、
  // サービス名を絞ったウェブ検索にフォールバックする(serviceSearchUrl 参照)。
  search?: (title: string) => string
}

// クエリ文字列に載せる(? 以降)
const q = (title: string) => encodeURIComponent(title)
// パスに埋め込む(/search/<word> 形式)
const p = (title: string) => encodeURIComponent(title)

// キーワードは前方のものから順に部分一致で判定する。
// 「dアニメストア ニコニコ支店」のように包含関係のある名前は先に置くこと。
export const SERVICES: StreamingService[] = [
  { key: 'danime-nico', label: 'dアニメストア ニコニコ支店', domain: 'nicovideo.jp', keywords: ['dアニメストア ニコニコ支店'], search: (t) => `https://www.nicovideo.jp/search/${p(t)}` },
  { key: 'danime', label: 'dアニメストア', domain: 'animestore.docomo.ne.jp', keywords: ['dアニメストア'], search: (t) => `https://animestore.docomo.ne.jp/animestore/sch_pc?searchKey=${q(t)}` },
  { key: 'niconico', label: 'ニコニコ', domain: 'nicovideo.jp', keywords: ['ニコニコ'], search: (t) => `https://www.nicovideo.jp/search/${p(t)}` },
  { key: 'netflix', label: 'Netflix', domain: 'netflix.com', keywords: ['netflix', 'ネットフリックス'], search: (t) => `https://www.netflix.com/search?q=${q(t)}` },
  { key: 'prime-video', label: 'Prime Video', domain: 'amazon.co.jp', keywords: ['prime video', 'プライム・ビデオ', 'プライムビデオ', 'amazon'], search: (t) => `https://www.amazon.co.jp/s?k=${q(t)}&i=instant-video` },
  { key: 'abema', label: 'ABEMA', domain: 'abema.tv', keywords: ['abema'], search: (t) => `https://abema.tv/search?q=${q(t)}` },
  { key: 'unext', label: 'U-NEXT', domain: 'video.unext.jp', keywords: ['u-next', 'unext'], search: (t) => `https://video.unext.jp/freeword?query=${q(t)}` },
  { key: 'hulu', label: 'Hulu', domain: 'hulu.jp', keywords: ['hulu', 'フールー'], search: (t) => `https://www.hulu.jp/search?q=${q(t)}` },
  { key: 'fod', label: 'FOD', domain: 'fod.fujitv.co.jp', keywords: ['fod'], search: (t) => `https://fod.fujitv.co.jp/title/search/?keyword=${q(t)}` },
  { key: 'dmmtv', label: 'DMM TV', domain: 'tv.dmm.com', keywords: ['dmm'], search: (t) => `https://tv.dmm.com/vod/list/?keyword=${q(t)}` },
  { key: 'lemino', label: 'Lemino', domain: 'lemino.docomo.ne.jp', keywords: ['lemino', 'dtv'], search: (t) => `https://lemino.docomo.ne.jp/search/word/${p(t)}` },
  { key: 'bandai', label: 'バンダイチャンネル', domain: 'b-ch.com', keywords: ['バンダイチャンネル'], search: (t) => `https://www.b-ch.com/search/?word=${q(t)}` },
  { key: 'youtube', label: 'YouTube', domain: 'youtube.com', keywords: ['youtube'], search: (t) => `https://www.youtube.com/results?search_query=${q(t)}` },
  { key: 'disneyplus', label: 'Disney+', domain: 'disneyplus.com', keywords: ['disney', 'ディズニープラス'] },
  { key: 'tver', label: 'TVer', domain: 'tver.jp', keywords: ['tver'], search: (t) => `https://tver.jp/search/${p(t)}` },
  { key: 'animehodai', label: 'アニメ放題', domain: 'animehodai.jp', keywords: ['アニメ放題'] },
  { key: 'crunchyroll', label: 'Crunchyroll', domain: 'crunchyroll.com', keywords: ['crunchyroll', 'クランチロール'], search: (t) => `https://www.crunchyroll.com/search?q=${q(t)}` },
  { key: 'animetimes', label: 'アニメタイムズ', domain: 'animetimes.com', keywords: ['アニメタイムズ'] },
  { key: 'wowow', label: 'WOWOWオンデマンド', domain: 'wowow.co.jp', keywords: ['wowowオンデマンド'], search: (t) => `https://www.wowow.co.jp/search/?q=${q(t)}` },
]

export function matchService(channelName: string): StreamingService | null {
  const name = channelName.toLowerCase()
  return SERVICES.find((s) => s.keywords.some((k) => name.includes(k.toLowerCase()))) ?? null
}

export function faviconUrl(service: StreamingService): string {
  return `https://www.google.com/s2/favicons?domain=${service.domain}&sz=32`
}

// サービス内でその作品を検索するページの URL。
// 専用の検索 URL があればそれを、無ければ「タイトル サービス名」のウェブ検索を返す。
export function serviceSearchUrl(service: StreamingService, title: string): string {
  if (service.search) return service.search(title)
  return `https://www.google.com/search?q=${encodeURIComponent(`${title} ${service.label}`)}`
}
