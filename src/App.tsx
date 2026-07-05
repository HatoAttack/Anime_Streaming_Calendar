import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addSeasons,
  fetchSeasonWorks,
  getCurrentSeason,
  sameSeason,
  seasonLabel,
  seasonSlug,
  type Season,
} from './api'
import { buildWeek, type CalendarEntry, type DayColumn } from './calendar'
import { faviconUrl, SERVICES } from './services'
import type { Work } from './types'

const TOKEN_STORAGE_KEY = 'annict_token'
const HIDDEN_STORAGE_KEY = 'hidden_work_ids'
const FAVORITE_STORAGE_KEY = 'favorite_work_ids'
const SERVICES_STORAGE_KEY = 'enabled_service_keys'
const HIDE_LATE_STORAGE_KEY = 'hide_late_entries'

// カードを縦に伸ばさないため favicon はこの数まで表示し、残りは +N バッジにまとめる
const MAX_FAVICONS = 4

function loadToken(): string {
  return localStorage.getItem(TOKEN_STORAGE_KEY) ?? (import.meta.env.VITE_ANNICT_TOKEN as string | undefined) ?? ''
}

function loadIdList(key: string): number[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'number') : []
  } catch {
    return []
  }
}

// 保存がなければ全サービス有効。保存済みの場合は現存するサービスキーだけ残す
function loadEnabledServiceKeys(): string[] {
  const allKeys = SERVICES.map((s) => s.key)
  try {
    const raw = localStorage.getItem(SERVICES_STORAGE_KEY)
    if (!raw) return allKeys
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return allKeys
    return allKeys.filter((key) => parsed.includes(key))
  } catch {
    return allKeys
  }
}

function TokenSetup({ onSave }: { onSave: (token: string) => void }) {
  const [input, setInput] = useState('')
  return (
    <div className="token-setup">
      <h2>Annict アクセストークンの設定</h2>
      <p>
        このアプリは <a href="https://annict.com" target="_blank" rel="noreferrer">Annict</a> の API
        から今クールの放送・配信情報を取得します。利用には個人用アクセストークンが必要です。
      </p>
      <ol>
        <li>
          <a href="https://annict.com/settings/apps" target="_blank" rel="noreferrer">
            Annict の設定 → アプリケーション
          </a>
          を開く
        </li>
        <li>「個人用アクセストークン」を作成(スコープは「読み込み専用」でOK)</li>
        <li>発行されたトークンを下に貼り付けて保存</li>
      </ol>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (input.trim()) onSave(input.trim())
        }}
      >
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="アクセストークンを貼り付け"
          autoFocus
        />
        <button type="submit" disabled={!input.trim()}>保存</button>
      </form>
      <p className="note">トークンはこのブラウザの localStorage にのみ保存されます。</p>
    </div>
  )
}

// スマートフォン幅では 7 列グリッドではなく 1 日表示+曜日タブ/スワイプに切り替える
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 640px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}

function FavButton({
  isFavorite,
  title,
  onToggle,
}: {
  isFavorite: boolean
  title: string
  onToggle: () => void
}) {
  return (
    <button
      className={`fav-button${isFavorite ? ' on' : ''}`}
      title={isFavorite ? 'お気に入りから外す' : 'お気に入りに登録'}
      aria-label={`${title} を${isFavorite ? 'お気に入りから外す' : 'お気に入りに登録'}`}
      aria-pressed={isFavorite}
      onClick={onToggle}
    >
      {isFavorite ? '★' : '☆'}
    </button>
  )
}

function EntryCard({
  entry,
  isFavorite,
  onToggleFavorite,
  onHide,
}: {
  entry: CalendarEntry
  isFavorite: boolean
  onToggleFavorite: (workId: number) => void
  onHide: (workId: number) => void
}) {
  const [expanded, setExpanded] = useState(false)

  // 遅れ配信は畳んだコンパクト表示が既定。ただしお気に入りは見逃さないよう常に展開する。
  // クリックで展開すると favicon 付きの通常カードになる
  if (entry.isLate && !expanded && !isFavorite) {
    return (
      <article className="entry late collapsed">
        <button
          className="expand-row"
          title="展開して配信サービスを表示"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
        >
          <span className="chevron">▸</span>
          <span className="time">{entry.time}</span>
          <span className="collapsed-title">{entry.title}</span>
        </button>
        <FavButton
          isFavorite={isFavorite}
          title={entry.title}
          onToggle={() => onToggleFavorite(entry.workId)}
        />
      </article>
    )
  }

  return (
    <article className={`entry${entry.isLate ? ' late' : ''}${isFavorite ? ' favorite' : ''}`}>
      <div className="entry-meta">
        <FavButton
          isFavorite={isFavorite}
          title={entry.title}
          onToggle={() => onToggleFavorite(entry.workId)}
        />
        {entry.isLate && !isFavorite && (
          <button
            className="expand-toggle"
            title="畳む"
            aria-expanded={true}
            onClick={() => setExpanded(false)}
          >
            ▾
          </button>
        )}
        <span className="time">{entry.time}</span>
        <span className="favicons">
          {entry.services.slice(0, MAX_FAVICONS).map((service) => (
            <img
              key={service.key}
              src={faviconUrl(service)}
              alt={service.label}
              title={service.label}
              width={16}
              height={16}
              loading="lazy"
            />
          ))}
          {entry.services.length > MAX_FAVICONS && (
            <span
              className="more-favicons"
              title={entry.services.slice(MAX_FAVICONS).map((s) => s.label).join(' / ')}
            >
              +{entry.services.length - MAX_FAVICONS}
            </span>
          )}
        </span>
        <button
          className="hide-button"
          title="このタイトルを非表示にする"
          aria-label={`${entry.title} を非表示にする`}
          onClick={() => onHide(entry.workId)}
        >
          ×
        </button>
      </div>
      <a className="title" href={entry.url} target="_blank" rel="noreferrer" title={entry.title}>
        {entry.title}
      </a>
    </article>
  )
}

// お気に入りを先頭へ浮上させる(元の時刻順は各グループ内で保たれる)。
// 「遅れ配信を隠す」はお気に入りにも等しく適用し、最速配信だけを残す
function orderEntries(
  entries: CalendarEntry[],
  hideLate: boolean,
  favorites: ReadonlySet<number>,
): CalendarEntry[] {
  const filtered = hideLate ? entries.filter((e) => !e.isLate) : entries
  return [...filtered].sort(
    (a, b) => (favorites.has(a.workId) ? 0 : 1) - (favorites.has(b.workId) ? 0 : 1),
  )
}

function Calendar({
  days,
  hideLate,
  showDates,
  favorites,
  onToggleFavorite,
  onHide,
}: {
  days: DayColumn[]
  hideLate: boolean
  showDates: boolean
  favorites: ReadonlySet<number>
  onToggleFavorite: (workId: number) => void
  onHide: (workId: number) => void
}) {
  return (
    <div className="calendar">
      {days.map((day) => {
        const entries = orderEntries(day.entries, hideLate, favorites)
        return (
          <section
            key={day.dateLabel}
            className={`day-column${showDates && day.isToday ? ' today' : ''}`}
          >
            <header className={`day-header weekday-${day.weekday}`}>
              <span className="weekday">{day.weekdayLabel}</span>
              {showDates && <span className="date">{day.dateLabel}</span>}
              {showDates && day.isToday && <span className="today-badge">今日</span>}
            </header>
            <div className="day-entries">
              {entries.length === 0 && <p className="empty">配信なし</p>}
              {entries.map((entry) => (
                <EntryCard
                  key={entry.workId}
                  entry={entry}
                  isFavorite={favorites.has(entry.workId)}
                  onToggleFavorite={onToggleFavorite}
                  onHide={onHide}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function MobileCalendar({
  days,
  hideLate,
  showDates,
  favorites,
  onToggleFavorite,
  onHide,
}: {
  days: DayColumn[]
  hideLate: boolean
  showDates: boolean
  favorites: ReadonlySet<number>
  onToggleFavorite: (workId: number) => void
  onHide: (workId: number) => void
}) {
  // 初期表示は今日(先頭列は昨日なので通常 index 1)
  const [dayIndex, setDayIndex] = useState(() => Math.max(days.findIndex((d) => d.isToday), 0))
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  const day = days[dayIndex]
  const entries = orderEntries(day.entries, hideLate, favorites)

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    // 縦スクロールと区別するため、横方向に十分大きい移動だけ曜日送りにする
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx < 0) {
      setDayIndex((i) => Math.min(i + 1, days.length - 1))
    } else {
      setDayIndex((i) => Math.max(i - 1, 0))
    }
  }

  return (
    <div className="mobile-calendar">
      <div className="day-tabs">
        {days.map((d, i) => (
          <button
            key={d.dateLabel}
            className={`day-tab weekday-${d.weekday}${i === dayIndex ? ' active' : ''}${showDates && d.isToday ? ' is-today' : ''}`}
            onClick={() => setDayIndex(i)}
          >
            <span className="weekday">{d.weekdayLabel}</span>
            {showDates && <span className="date">{d.dateLabel}</span>}
          </button>
        ))}
      </div>
      <section
        className="day-column mobile"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <header className={`day-header weekday-${day.weekday}`}>
          <span className="weekday">{day.weekdayLabel}曜日</span>
          {showDates && <span className="date">{day.dateLabel}</span>}
          {showDates && day.isToday && <span className="today-badge">今日</span>}
        </header>
        <div className="day-entries">
          {entries.length === 0 && <p className="empty">配信なし</p>}
          {entries.map((entry) => (
            <EntryCard
              key={entry.workId}
              entry={entry}
              isFavorite={favorites.has(entry.workId)}
              onToggleFavorite={onToggleFavorite}
              onHide={onHide}
            />
          ))}
        </div>
      </section>
      <p className="swipe-hint">左右にスワイプで曜日を移動できます</p>
    </div>
  )
}

function ServicePanel({
  enabledKeys,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: {
  enabledKeys: string[]
  onToggle: (key: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
}) {
  return (
    <div className="service-panel">
      <div className="service-panel-header">
        <h2>表示するサービス</h2>
        <div className="service-panel-actions">
          <button className="secondary" onClick={onSelectAll}>すべて選択</button>
          <button className="secondary" onClick={onDeselectAll}>すべて解除</button>
        </div>
      </div>
      <div className="service-grid">
        {SERVICES.map((service) => {
          const enabled = enabledKeys.includes(service.key)
          return (
            <label key={service.key} className={`service-item${enabled ? ' on' : ''}`}>
              <input type="checkbox" checked={enabled} onChange={() => onToggle(service.key)} />
              <img src={faviconUrl(service)} alt="" width={16} height={16} loading="lazy" />
              <span>{service.label}</span>
            </label>
          )
        })}
      </div>
      <p className="note">チェックを外したサービスの配信予定はカレンダーに表示されません(契約していないサービスの除外に)。</p>
    </div>
  )
}

function HiddenPanel({
  hiddenWorks,
  onRestore,
  onRestoreAll,
}: {
  hiddenWorks: Work[]
  onRestore: (workId: number) => void
  onRestoreAll: () => void
}) {
  return (
    <div className="hidden-panel">
      <div className="hidden-panel-header">
        <h2>非表示中のタイトル({hiddenWorks.length})</h2>
        {hiddenWorks.length > 0 && (
          <button className="secondary" onClick={onRestoreAll}>すべて戻す</button>
        )}
      </div>
      {hiddenWorks.length === 0 ? (
        <p className="note">非表示にしたタイトルはありません。カレンダーの × ボタンで非表示にできます。</p>
      ) : (
        <ul>
          {hiddenWorks.map((work) => (
            <li key={work.annictId}>
              <span>{work.title}</span>
              <button className="secondary" onClick={() => onRestore(work.annictId)}>戻す</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState(loadToken)
  const [works, setWorks] = useState<Work[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hiddenIds, setHiddenIds] = useState<number[]>(() => loadIdList(HIDDEN_STORAGE_KEY))
  const [showHiddenPanel, setShowHiddenPanel] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState<number[]>(() => loadIdList(FAVORITE_STORAGE_KEY))
  const [enabledKeys, setEnabledKeys] = useState<string[]>(loadEnabledServiceKeys)
  const [showServicePanel, setShowServicePanel] = useState(false)
  const [hideLate, setHideLate] = useState(() => localStorage.getItem(HIDE_LATE_STORAGE_KEY) === '1')
  const isMobile = useIsMobile()

  const currentSeason = useMemo(() => getCurrentSeason(), [])
  const [season, setSeason] = useState<Season>(currentSeason)
  const isCurrentSeason = sameSeason(season, currentSeason)

  const load = useCallback(async (accessToken: string) => {
    setLoading(true)
    setError(null)
    try {
      setWorks(await fetchSeasonWorks(accessToken, seasonSlug(season)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setWorks(null)
    } finally {
      setLoading(false)
    }
  }, [season])

  useEffect(() => {
    if (token) void load(token)
  }, [token, load])

  const saveToken = (value: string) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, value)
    setToken(value)
  }

  const clearToken = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setToken('')
    setWorks(null)
    setError(null)
  }

  const updateHiddenIds = (ids: number[]) => {
    setHiddenIds(ids)
    localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(ids))
  }

  const hideWork = (workId: number) => {
    if (!hiddenIds.includes(workId)) updateHiddenIds([...hiddenIds, workId])
  }

  const restoreWork = (workId: number) => {
    updateHiddenIds(hiddenIds.filter((id) => id !== workId))
  }

  const restoreAll = () => {
    updateHiddenIds([])
    setShowHiddenPanel(false)
  }

  const toggleFavorite = (workId: number) => {
    const next = favoriteIds.includes(workId)
      ? favoriteIds.filter((id) => id !== workId)
      : [...favoriteIds, workId]
    setFavoriteIds(next)
    localStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify(next))
  }

  const updateEnabledKeys = (keys: string[]) => {
    setEnabledKeys(keys)
    localStorage.setItem(SERVICES_STORAGE_KEY, JSON.stringify(keys))
  }

  const toggleService = (key: string) => {
    updateEnabledKeys(
      enabledKeys.includes(key) ? enabledKeys.filter((k) => k !== key) : [...enabledKeys, key],
    )
  }

  const toggleHideLate = () => {
    setHideLate((v) => {
      localStorage.setItem(HIDE_LATE_STORAGE_KEY, v ? '0' : '1')
      return !v
    })
  }

  const days = useMemo(
    () =>
      works
        ? buildWeek(works.filter((w) => !hiddenIds.includes(w.annictId)), new Set(enabledKeys))
        : null,
    [works, hiddenIds, enabledKeys],
  )
  const shownCount = useMemo(
    () => (days ? new Set(days.flatMap((d) => d.entries.map((e) => e.workId))).size : 0),
    [days],
  )
  const hiddenWorks = useMemo(
    () =>
      (works ?? [])
        .filter((w) => hiddenIds.includes(w.annictId))
        .sort((a, b) => a.title.localeCompare(b.title, 'ja')),
    [works, hiddenIds],
  )
  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds])

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>
            アニ曜日
            <span className="tagline">このアニメ、サブスク配信は何曜日?</span>
          </h1>
          <div className="season-nav">
            <button
              className="secondary season-arrow"
              title="前のクール"
              onClick={() => setSeason(addSeasons(season, -1))}
              disabled={loading}
            >
              ◀
            </button>
            <span className="season">{seasonLabel(season)}</span>
            <button
              className="secondary season-arrow"
              title="次のクール"
              onClick={() => setSeason(addSeasons(season, 1))}
              disabled={loading}
            >
              ▶
            </button>
            {!isCurrentSeason && (
              <button className="secondary" onClick={() => setSeason(currentSeason)} disabled={loading}>
                今クールへ
              </button>
            )}
            {days && <span className="work-count">配信中 {shownCount} 作品</span>}
          </div>
        </div>
        {token && (
          <div className="actions">
            <label className="toggle" title="週内で 2 番目以降の配信(遅れ配信)をカレンダーから隠します。選択中のサービスの中で最も早い配信は常に表示されます。">
              <input type="checkbox" checked={hideLate} onChange={toggleHideLate} />
              遅れ配信を隠す
            </label>
            <button
              className="secondary"
              onClick={() => {
                setShowServicePanel((v) => !v)
                setShowHiddenPanel(false)
              }}
              aria-expanded={showServicePanel}
            >
              サービス({enabledKeys.length}/{SERVICES.length})
            </button>
            <button
              className="secondary"
              onClick={() => {
                setShowHiddenPanel((v) => !v)
                setShowServicePanel(false)
              }}
              aria-expanded={showHiddenPanel}
            >
              非表示リスト({hiddenIds.length})
            </button>
            <button onClick={() => void load(token)} disabled={loading}>再読み込み</button>
            <button className="secondary" onClick={clearToken}>トークン変更</button>
          </div>
        )}
      </header>

      {!token && <TokenSetup onSave={saveToken} />}
      {token && showServicePanel && (
        <ServicePanel
          enabledKeys={enabledKeys}
          onToggle={toggleService}
          onSelectAll={() => updateEnabledKeys(SERVICES.map((s) => s.key))}
          onDeselectAll={() => updateEnabledKeys([])}
        />
      )}
      {token && showHiddenPanel && (
        <HiddenPanel hiddenWorks={hiddenWorks} onRestore={restoreWork} onRestoreAll={restoreAll} />
      )}
      {token && loading && <p className="status">Annict から取得中…</p>}
      {token && error && (
        <div className="error">
          <p>{error}</p>
          <button onClick={() => void load(token)}>再試行</button>
        </div>
      )}
      {token && !loading && !error && days && (
        isMobile ? (
          <MobileCalendar
            days={days}
            hideLate={hideLate}
            showDates={isCurrentSeason}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onHide={hideWork}
          />
        ) : (
          <Calendar
            days={days}
            hideLate={hideLate}
            showDates={isCurrentSeason}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onHide={hideWork}
          />
        )
      )}
    </div>
  )
}
