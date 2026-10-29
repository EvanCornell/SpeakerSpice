import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, runIndex, runDataOf } from '../store'
import { recordName } from '../records'
import {
  TABS, TAB_VIEWS, sharedTabs, tabTraces, nearestStart, unreachedAt, dbText, defaultRunName, cleanLevels, RUN_DEFAULTS,
} from '../runs'
import PlotChart from './PlotChart'
import { SERIES } from './TimeDomainWindow'
import NumInput from './NumInput'
import { displayNames } from '../nodeNames'

const DRAG_TYPE = 'application/x-speakerspice-runs'

export function useRuns() {
  const workspace = useStore((s) => s.workspace)
  const records = useStore((s) => s.records)
  const activeFile = useStore((s) => s.activeFile)
  const projectName = useStore((s) => s.projectName)
  return useMemo(() => runIndex({ workspace, records, activeFile, projectName }), [workspace, records, activeFile, projectName])
}

function runNames(entry, loaded) {
  return loaded?.content?.nodes ? displayNames(loaded.content.nodes) : (entry.info?.names || {})
}

function useRunData(entries) {
  useStore((s) => s.tdDataTick)
  const load = useStore((s) => s.loadRunData)
  useEffect(() => { for (const e of entries) if (e && !runDataOf(e.id)) load(e) }, [entries, load])
  return Object.fromEntries(entries.filter(Boolean).map((e) => [e.id, runDataOf(e.id)]))
}

function draggedRuns(e) {
  try { return JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]') } catch { return [] }
}

function dragRuns(e, ids) {
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids))
  e.dataTransfer.effectAllowed = 'copy'
}

const isRunDrag = (e) => Array.from(e.dataTransfer?.types || []).includes(DRAG_TYPE)

export function dayLabel(at, now = Date.now()) {
  const d = new Date(at)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
}

export function byDay(runs) {
  const groups = []
  for (const r of runs) {
    const day = dayLabel(r.at)
    const g = groups[groups.length - 1]
    if (g && g.day === day) g.runs.push(r)
    else groups.push({ day, runs: [r] })
  }
  return groups
}

export const NO_FILTERS = { query: '', project: '*', record: '' }

const recordKey = (r) => `${r.path}#${r.record}`

function searchText(r) {
  return `${r.title} ${dbText(r.levelDb ?? 0)} ${r.project} ${r.recordName}`.toLowerCase().replace(/−/g, '-')
}

export function filterRuns(runs, f, skip) {
  const words = f.query.toLowerCase().replace(/−/g, '-').split(/\s+/).filter(Boolean)
  return runs.filter((r) => (skip === 'project' || f.project === '*' || (f.project ? r.path === f.project : r.open))
    && (skip === 'record' || !f.record || recordKey(r) === f.record)
    && (!words.length || words.every((w) => searchText(r).includes(w))))
}

export function filterChoices(runs, f) {
  const projectPool = filterRuns(runs, f, 'project')
  const projects = []
  for (const r of runs) if (!projects.some((p) => p.value === r.path)) projects.push({ value: r.path, label: r.project + (r.open ? ' (open)' : ''), open: r.open })
  projects.sort((a, b) => (b.open - a.open) || a.label.localeCompare(b.label))
  const recordPool = filterRuns(runs, f, 'record')
  const records = []
  for (const r of recordPool) {
    const key = recordKey(r)
    if (!records.some((x) => x.value === key)) records.push({ value: key, label: f.project === '*' && new Set(recordPool.map((x) => x.path)).size > 1 ? `${r.project} · ${r.recordName}` : r.recordName })
  }
  records.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
  return {
    project: [{ value: '*', label: 'All projects', count: projectPool.length },
      ...projects.map((p) => ({ ...p, count: projectPool.filter((r) => r.path === p.value).length }))],
    record: [{ value: '', label: 'Any record', count: recordPool.length },
      ...records.map((x) => ({ ...x, count: recordPool.filter((r) => recordKey(r) === x.value).length }))],
  }
}

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

function FilterChip({ name, choices, value, onChange }) {
  const [open, setOpen] = useState(false)
  const set = value !== choices[0].value
  const chosen = choices.find((c) => c.value === value)
  return (
    <span className="lib-chip-wrap">
      <button className={`lib-chip${set ? ' set' : ''}${open ? ' open' : ''}`} onClick={() => setOpen(!open)} title={`Filter by ${name.toLowerCase()}`}>
        <span className="lib-chip-name">{name}</span>
        {set && <span className="lib-chip-value">{chosen?.label ?? value}</span>}
        {set
          ? <span className="lib-chip-x" title="Clear" onClick={(e) => { e.stopPropagation(); onChange(choices[0].value) }}>✕</span>
          : <span className="lib-chip-caret">▾</span>}
      </button>
      {open && (
        <>
          <div className="menu-veil" onClick={() => setOpen(false)} />
          <div className="lib-menu lib-chip-menu">
            {choices.map((c, i) => (
              <button key={c.value} className={`${c.value === value ? 'on' : ''}${i === 0 ? ' any' : ''}`} disabled={!c.count && c.value !== value}
                onClick={() => { onChange(c.value); setOpen(false) }}>
                <span className="lib-chip-check">{c.value === value ? '✓' : ''}</span>
                <span className="lib-chip-label">{c.label}</span>
                <span className="lib-count">{c.count}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  )
}

function RunName({ run }) {
  const [text, setText] = useState(null)
  const commit = () => {
    const t = (text || '').trim()
    if (t && t !== run.title) useStore.getState().renameRun(run, t)
    setText(null)
  }
  if (text != null) {
    return (
      <input className="run-name-edit" autoFocus value={text} spellCheck={false} onChange={(e) => setText(e.target.value)}
        onClick={(e) => e.stopPropagation()} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') { e.stopPropagation(); setText(null) } }} />
    )
  }
  return (
    <span className="run-name" title="Click to rename" onClick={(e) => { e.stopPropagation(); setText(run.title) }}>{run.title}</span>
  )
}

function RunRow({ run, color, onMenu }) {
  const st = useStore.getState
  return (
    <div className={`run-row${color ? ' on' : ''}`} draggable onDragStart={(e) => dragRuns(e, [run.id])}
      onClick={() => st().viewRuns([run.id])} onContextMenu={(e) => { e.preventDefault(); onMenu(e) }}
      title="Click to open; drag onto the viewer, or ⊕, to overlay">
      <span className="run-swatch" style={color ? { background: color } : undefined} />
      <div className="run-text">
        <div className="run-line">
          <div className="run-name-scroll"><RunName run={run} /></div>
          <span className="run-level">{dbText(run.levelDb ?? 0)}</span>
        </div>
        <div className="run-meta">{run.project} · {run.recordName}</div>
      </div>
      <div className="run-actions">
        <button className="run-act" title="Overlay on the runs open in the viewer" onClick={(e) => { e.stopPropagation(); st().viewRuns([run.id], true) }}>⊕</button>
        <button className="run-act" title="More" onClick={(e) => { e.stopPropagation(); onMenu(e) }}>⋯</button>
      </div>
    </div>
  )
}

function RunMenu({ at, onClose }) {
  const st = useStore.getState
  const { run } = at
  const act = (fn) => { onClose(); fn() }
  return (
    <>
      <div className="menu-veil" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="lib-menu" style={{ left: at.x, top: at.y }}>
        <button onClick={() => act(() => st().viewRuns([run.id]))}>Open</button>
        <button onClick={() => act(() => st().viewRuns([run.id], true))}>Overlay on the open runs</button>
        <button onClick={() => act(() => st().restoreRunAsRecord(run))}
          title="Add this run's project to the open project as a new record at the end, and show it">Restore as new record</button>
        <button className="danger" onClick={() => act(() => { if (confirm(`Delete "${run.title}" (${dbText(run.levelDb ?? 0)})? Its results go with it.`)) st().deleteRuns([run]) })}>Delete</button>
      </div>
    </>
  )
}

function QueueList() {
  const queue = useStore((s) => s.tdQueue)
  const remove = useStore((s) => s.removeQueued)
  if (!queue.length) return null
  return (
    <div className="lib-queue">
      {queue.map((j) => (
        <div key={j.id} className={`lib-job ${j.status}`}>
          <div className="run-line">
            <span className="run-name-static">{j.title}</span>
            <span className="run-level">{dbText(j.levelDb ?? 0)}</span>
            <button className="run-act" title={j.status === 'running' ? 'Cancel' : 'Remove'} onClick={() => remove(j.id)}>✕</button>
          </div>
          {j.status === 'failed'
            ? <div className="lib-error">{j.error}</div>
            : (
              <>
                <div className="td-bar"><div style={{ width: `${Math.round((j.fraction || 0) * 100)}%` }} /></div>
                <div className="run-meta">{j.status === 'queued' ? 'Queued' : j.message}</div>
              </>
            )}
        </div>
      ))}
    </div>
  )
}

export function RunLibrary() {
  const runs = useRuns()
  const open = useStore((s) => s.tdView.runs)
  const [filters, setFilters] = useState(NO_FILTERS)
  const [menu, setMenu] = useState(null)
  const searchRef = useRef(null)
  const filter = (patch) => setFilters((f) => ({ ...f, ...patch, ...('project' in patch && patch.project !== f.project ? { record: '' } : {}) }))
  const shown = filterRuns(runs, filters)
  const choices = filterChoices(runs, filters)
  const filtered = Object.keys(NO_FILTERS).some((k) => filters[k] !== NO_FILTERS[k])
  return (
    <div className="lib">
      <div className="lib-head">
        <span className="lib-heading">Runs</span>
        <span className="lib-count">{shown.length}</span>
        <span style={{ flex: 1 }} />
        {filtered && <button className="lib-clear" onClick={() => setFilters(NO_FILTERS)}>Clear</button>}
      </div>
      <label className={`lib-search${filters.query ? ' set' : ''}`}>
        <SearchIcon />
        <input ref={searchRef} placeholder="Search runs, projects, records…" value={filters.query} spellCheck={false}
          onChange={(e) => filter({ query: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Escape' && filters.query) { e.stopPropagation(); filter({ query: '' }) } }} />
        {filters.query && <button className="lib-search-x" title="Clear the search" onClick={() => { filter({ query: '' }); searchRef.current?.focus() }}>✕</button>}
      </label>
      <div className="lib-chips">
        <FilterChip name="Project" choices={choices.project} value={filters.project} onChange={(project) => filter({ project })} />
        <FilterChip name="Record" choices={choices.record} value={filters.record} onChange={(record) => filter({ record })} />
      </div>
      <div className="lib-body">
        <QueueList />
        {!shown.length && (
          <div className="lib-empty">
            {runs.length ? <>No runs match. <button className="lib-clear" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button></> : 'No runs yet. Press New run: each level you add is kept here as its own run, with the project as it was run.'}
          </div>
        )}
        {byDay(shown).map((g) => (
          <div key={g.day} className="lib-group">
            <div className="lib-day">{g.day}<span>{g.runs.length}</span></div>
            {g.runs.map((r) => {
              const i = open.indexOf(r.id)
              return <RunRow key={r.id} run={r} color={i >= 0 ? SERIES[i % SERIES.length] : null}
                onMenu={(e) => setMenu({ run: r, x: e.clientX, y: e.clientY })} />
            })}
          </div>
        ))}
      </div>
      <div className="lib-foot">Click a run to open it · drag more onto the viewer to overlay</div>
      {menu && <RunMenu at={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}

function ViewChart({ tab, view, runs, hz, linear = true }) {
  const unit = (TAB_VIEWS[tab].find((v) => v[0] === view) || TAB_VIEWS[tab][0])[2]
  const series = []
  for (const r of runs) {
    const traces = tabTraces(tab, view, r.result, r.names, hz).filter((t) => linear || !t.dash)
    traces.forEach((t, k) => {
      const solo = runs.length === 1
      const name = solo
        ? (t.label || TAB_VIEWS[tab].find((v) => v[0] === view)?.[1] || '')
        : `${r.entry.title} ${dbText(r.entry.levelDb ?? 0)}${t.label ? ` · ${t.label}` : ''}`
      series.push({
        key: `${r.entry.id}:${t.key}`, name, x: t.x, y: t.y, dash: t.dash, marker: t.marker,
        color: solo ? (t.dash ? 'var(--text-3)' : SERIES[k % SERIES.length]) : r.color,
      })
    })
  }
  const time = tab === 'waveforms'
  const logY = tab === 'impedance'
  return (
    <PlotChart series={series} logX={!time} logY={logY} ylabel={unit} xunit={time ? 'time, ms' : 'frequency, Hz'}
      refs={tab === 'compression' || (tab === 'waveforms' && view !== 'pressure') ? [{ y: 0, color: 'var(--line-2)' }] : []} />
  )
}

export function RunViewer() {
  const all = useRuns()
  const view = useStore((s) => s.tdView)
  const st = useStore.getState
  const [over, setOver] = useState(false)
  const [sub, setSub] = useState({})
  const [hz, setHz] = useState(null)
  const entries = useMemo(() => view.runs.map((id) => all.find((r) => r.id === id)).filter(Boolean), [view.runs, all])
  const data = useRunData(entries)
  const loaded = entries
    .map((entry, i) => ({ entry, result: data[entry.id]?.data?.result, names: runNames(entry, data[entry.id]), color: SERIES[view.runs.indexOf(entry.id) % SERIES.length] }))
    .filter((r) => r.result)
  const pending = entries.filter((e) => !data[e.id] || data[e.id].loading)
  const errors = entries.filter((e) => data[e.id]?.error)
  const tabs = sharedTabs(loaded.map((r) => r.result))
  const tab = tabs.includes(view.tab) ? view.tab : tabs[0]
  const views = tab ? TAB_VIEWS[tab] : []
  const v = views.some((x) => x[0] === sub[tab]) ? sub[tab] : views[0]?.[0]
  const freqs = loaded[0]?.result?.freqs || []
  const tone = hz ?? freqs[Math.min(freqs.length - 1, Math.floor(freqs.length / 3))]
  const unreached = tab === 'maxspl' ? loaded.flatMap((r) => unreachedAt(r.result).map((f) => ({ f, r }))) : []
  const toneHz = tab === 'waveforms' && loaded.length ? (nearestStart(loaded[0].result, tone)?.hz ?? tone) : undefined
  const hasLinear = !!tab && loaded.some((r) => tabTraces(tab, v, r.result, r.names, toneHz).some((t) => t.dash))
  const drop = (e) => {
    e.preventDefault()
    setOver(false)
    const ids = draggedRuns(e)
    if (ids.length) st().viewRuns(ids, true)
  }
  return (
    <div className={`viewer${over ? ' drop' : ''}`}
      onDragOver={(e) => { if (isRunDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false) }} onDrop={drop}>
      {!entries.length
        ? (
          <div className="viewer-empty">
            <div className="viewer-empty-title">Open a run</div>
            <div>Click a run in the library to see everything it measured. Drag more runs here to overlay them.</div>
          </div>
        )
        : (
          <>
            <div className="viewer-runs">
              {entries.map((e) => (
                <span key={e.id} className="viewer-chip" title={`${e.project} · ${e.recordName}`}>
                  <i style={{ background: SERIES[view.runs.indexOf(e.id) % SERIES.length] }} />
                  <span className="viewer-chip-name">{e.title}</span>
                  <span className="run-level">{dbText(e.levelDb ?? 0)}</span>
                  <button className="run-act" title="Close this run" onClick={() => st().closeRun(e.id)}>✕</button>
                </span>
              ))}
              {entries.length > 1 && <button className="lib-clear" onClick={() => st().closeRun()}>Close all</button>}
              <span className="viewer-hint">Drag runs here to overlay</span>
            </div>
            {pending.length > 0 && !loaded.length && <div className="viewer-note">Reading results…</div>}
            {errors.map((e) => <div key={e.id} className="viewer-note bad">{e.title}: {data[e.id].error}</div>)}
            {loaded.length > 0 && (
              <>
                <div className="viewer-tabs">
                  {TABS.filter(([id]) => tabs.includes(id)).map(([id, label]) => (
                    <button key={id} className={tab === id ? 'active' : ''} onClick={() => st().setViewTab(id)}>{label}</button>
                  ))}
                </div>
                <div className="viewer-tools">
                  {views.length > 1 && (
                    <div className="seg small">
                      {views.map(([id, label]) => <button key={id} className={v === id ? 'on' : ''} onClick={() => setSub({ ...sub, [tab]: id })}>{label}</button>)}
                    </div>
                  )}
                  {hasLinear && (
                    <button className={`chip-toggle dashed${view.linear !== false ? ' on' : ''}`} aria-pressed={view.linear !== false}
                      title="Show or hide the linear model: the same project with every nonlinearity switched off"
                      onClick={() => st().setViewLinear(view.linear === false)}>
                      <span className="ct-swatch" style={{ borderTopStyle: 'dashed' }} />Linear
                    </button>
                  )}
                  {tab === 'waveforms' && (
                    <label className="viewer-tone">Tone
                      <select value={tone} onChange={(e) => setHz(Number(e.target.value))}>
                        {freqs.map((f) => <option key={f} value={f}>{f} Hz</option>)}
                      </select>
                      <span className="run-meta">from switch-on{loaded.length > 1 ? ', each run at its nearest tone' : ''}</span>
                    </label>
                  )}
                  {tab === 'maxspl' && (
                    <span className="run-meta">
                      The level at which THD reaches 10%, found tone by tone (within 0.25 dB). Excursion and power ratings play no part.
                    </span>
                  )}
                </div>
                <div className="viewer-chart">
                  <ViewChart tab={tab} view={v} runs={loaded} hz={toneHz} linear={view.linear !== false} />
                </div>
                {unreached.length > 0 && (
                  <div className="viewer-note">
                    THD stayed under 10% up to the top of the search (40 dB over the run&apos;s level) at {[...new Set(unreached.map((u) => u.f))].join(', ')} Hz: those points are floors, not limits.
                  </div>
                )}
              </>
            )}
          </>
        )}
    </div>
  )
}

export function NewRunDrawer() {
  const draft = useStore((s) => s.tdDraft)
  const setDraft = useStore((s) => s.setTdDraft)
  const hasNodes = useStore((s) => s.nodes.length > 0)
  const projectName = useStore((s) => s.projectName)
  const records = useStore((s) => s.records)
  const nav = useStore((s) => s.recordNav)
  const busy = useStore((s) => s.tdQueue.some((j) => j.status === 'running'))
  const st = useStore.getState
  const placeholder = defaultRunName(projectName, recordName(records, nav.selected))
  const levels = draft.levels
  const valid = cleanLevels(levels)
  const setLevel = (i, v) => setDraft({ levels: v == null ? levels.filter((_, k) => k !== i) : levels.map((x, k) => (k === i ? v : x)) })
  const run = () => {
    st().queueRuns()
    st().setTdDrawer(false)
  }
  const tones = Math.round(Number(draft.points) || RUN_DEFAULTS.points)
  return (
    <div className="drawer">
      <div className="drawer-head">
        <span className="drawer-title">New run</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="Close" onClick={() => st().setTdDrawer(false)}>✕</button>
      </div>
      <div className="drawer-body">
        <div className="drawer-field">
          <div className="drawer-label">Name</div>
          <input className="drawer-name" value={draft.name} placeholder={placeholder} spellCheck={false}
            onChange={(e) => setDraft({ name: e.target.value })} />
        </div>
        <div className="drawer-field">
          <div className="drawer-label">Output levels <span className="run-meta">each level is its own run</span></div>
          <div className="level-list">
            {levels.map((L, i) => (
              <div key={i} className="level-row">
                <NumInput value={L} onCommit={(v) => setLevel(i, v)} step={1} aria-label={`Level ${i + 1}`} />
                <span className="run-meta">dB</span>
                <span style={{ flex: 1 }} />
                {levels.length > 1 && <button className="run-act" title="Remove this level" onClick={() => setLevel(i, null)}>✕</button>}
              </div>
            ))}
            <button className="level-add" onClick={() => setDraft({ levels: [...levels, levels.length ? Math.max(...valid, 0) + 6 : 0] })}>+ Add level</button>
          </div>
          <div className="run-meta">0 dB is the project&apos;s drive level; +6 dB doubles the voltage.</div>
        </div>
        <div className="drawer-field">
          <div className="drawer-label">Range</div>
          <div className="range-row">
            <NumInput value={draft.f1} above={0} onCommit={(f1) => setDraft({ f1 })} aria-label="From" /> <span className="run-meta">to</span>
            <NumInput value={draft.f2} above={0} onCommit={(f2) => setDraft({ f2 })} aria-label="To" /> <span className="run-meta">Hz,</span>
            <NumInput value={draft.points} min={2} max={200} integer onCommit={(points) => setDraft({ points })} aria-label="Tones" /> <span className="run-meta">tones</span>
          </div>
        </div>
        <div className="drawer-field run-meta">
          Each run measures a steady tone at every frequency — output and compression against the linear model, THD and
          harmonics, excursion, port velocity, impedance, power and each tone&apos;s start-up.
        </div>
      </div>
      <div className="drawer-foot">
        <span className="run-meta">{valid.length} run{valid.length === 1 ? '' : 's'} · {tones} tones each{busy ? ' · queued behind the run solving' : ''}</span>
        <span style={{ flex: 1 }} />
        <button className="primary" disabled={!hasNodes || !valid.length || !(Number(draft.f2) > Number(draft.f1))} onClick={run}>
          {busy ? 'Queue' : 'Run'}{valid.length > 1 ? ` ${valid.length} levels` : ''}
        </button>
      </div>
    </div>
  )
}
