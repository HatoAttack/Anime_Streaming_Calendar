// Annict のチャンネル名 → 動画配信ストリーミングサービスの対応表。
// テレビ局などここに載っていないチャンネルの放送予定はカレンダーに表示しない。
export interface StreamingService {
  key: string
  label: string
  domain: string
  keywords: string[]
}

// キーワードは前方のものから順に部分一致で判定する。
// 「dアニメストア ニコニコ支店」のように包含関係のある名前は先に置くこと。
export const SERVICES: StreamingService[] = [
  { key: 'danime-nico', label: 'dアニメストア ニコニコ支店', domain: 'nicovideo.jp', keywords: ['dアニメストア ニコニコ支店'] },
  { key: 'danime', label: 'dアニメストア', domain: 'animestore.docomo.ne.jp', keywords: ['dアニメストア'] },
  { key: 'niconico', label: 'ニコニコ', domain: 'nicovideo.jp', keywords: ['ニコニコ'] },
  { key: 'netflix', label: 'Netflix', domain: 'netflix.com', keywords: ['netflix', 'ネットフリックス'] },
  { key: 'prime-video', label: 'Prime Video', domain: 'amazon.co.jp', keywords: ['prime video', 'プライム・ビデオ', 'プライムビデオ', 'amazon'] },
  { key: 'abema', label: 'ABEMA', domain: 'abema.tv', keywords: ['abema'] },
  { key: 'unext', label: 'U-NEXT', domain: 'video.unext.jp', keywords: ['u-next', 'unext'] },
  { key: 'hulu', label: 'Hulu', domain: 'hulu.jp', keywords: ['hulu', 'フールー'] },
  { key: 'fod', label: 'FOD', domain: 'fod.fujitv.co.jp', keywords: ['fod'] },
  { key: 'dmmtv', label: 'DMM TV', domain: 'tv.dmm.com', keywords: ['dmm'] },
  { key: 'lemino', label: 'Lemino', domain: 'lemino.docomo.ne.jp', keywords: ['lemino', 'dtv'] },
  { key: 'bandai', label: 'バンダイチャンネル', domain: 'b-ch.com', keywords: ['バンダイチャンネル'] },
  { key: 'youtube', label: 'YouTube', domain: 'youtube.com', keywords: ['youtube'] },
  { key: 'disneyplus', label: 'Disney+', domain: 'disneyplus.com', keywords: ['disney', 'ディズニープラス'] },
  { key: 'tver', label: 'TVer', domain: 'tver.jp', keywords: ['tver'] },
  { key: 'animehodai', label: 'アニメ放題', domain: 'animehodai.jp', keywords: ['アニメ放題'] },
  { key: 'crunchyroll', label: 'Crunchyroll', domain: 'crunchyroll.com', keywords: ['crunchyroll', 'クランチロール'] },
  { key: 'animetimes', label: 'アニメタイムズ', domain: 'animetimes.com', keywords: ['アニメタイムズ'] },
  { key: 'wowow', label: 'WOWOWオンデマンド', domain: 'wowow.co.jp', keywords: ['wowowオンデマンド'] },
]

export function matchService(channelName: string): StreamingService | null {
  const name = channelName.toLowerCase()
  return SERVICES.find((s) => s.keywords.some((k) => name.includes(k.toLowerCase()))) ?? null
}

export function faviconUrl(service: StreamingService): string {
  return `https://www.google.com/s2/favicons?domain=${service.domain}&sz=32`
}
