import React, { useLayoutEffect, useRef, useState } from 'react'

const EDGE_PAD = 6

export function Item({ label, hint, onClick, disabled, checked, danger, submenu, submenuSide = 'right' }) {
  const [openSub, setOpenSub] = useState(false)
  const subRef = useRef(null)
  const [fit, setFit] = useState(null)

  useLayoutEffect(() => {
    if (!openSub) { setFit(null); return }
    const r = subRef.current?.getBoundingClientRect()
    if (!r) return
    let dy = Math.min(0, window.innerHeight - EDGE_PAD - r.bottom)
    if (r.top + dy < EDGE_PAD) dy = EDGE_PAD - r.top
    let side = submenuSide === 'left' ? 'left' : 'right'
    if (side === 'right' && r.right > window.innerWidth - EDGE_PAD) side = 'left'
    else if (side === 'left' && r.left < EDGE_PAD) side = 'right'
    setFit({ dy, side })
  }, [openSub, submenuSide])

  if (label === '-') return <div className="menu-sep" />
  return (
    <div
      className={`menu-item ${disabled ? 'disabled' : ''} ${danger ? 'danger' : ''}`}
      onMouseEnter={() => setOpenSub(true)}
      onMouseLeave={() => setOpenSub(false)}
      onClick={(e) => {
        if (disabled || submenu) { e.stopPropagation(); return }
        onClick?.()
      }}
    >
      <span className="mi-check">{checked ? '✓' : ''}</span>
      <span className="mi-label">{label}</span>
      {submenu
        ? <span className="mi-hint">{(fit?.side ?? submenuSide) === 'left' ? '◂' : '▸'}</span>
        : <span className="mi-hint">{hint || ''}</span>}
      {submenu && openSub && (
        <div
          ref={subRef}
          className={`menu-dropdown submenu ${(fit?.side ?? submenuSide) === 'left' ? 'to-left' : ''}`}
          style={{
            transform: fit?.dy ? `translateY(${fit.dy}px)` : undefined,
            visibility: fit ? 'visible' : 'hidden',
          }}
        >
          {submenu.map((it, i) => (
            <Item key={it.label === '-' ? `s${i}` : it.label} {...it} submenuSide={fit?.side ?? submenuSide} />
          ))}
        </div>
      )}
    </div>
  )
}

export function ItemList({ items, submenuSide = 'right' }) {
  return items.map((it, i) => (
    <Item key={it.label === '-' ? `s${i}` : it.label} {...it} submenuSide={submenuSide} />
  ))
}
