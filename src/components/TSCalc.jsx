import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useStore } from '../store'
import { RHO, C_AIR } from '../engine/geometry'
import { useBackdropDismiss } from '../utils/backdrop'

const TAU = 2 * Math.PI
const K = RHO * C_AIR * C_AIR

function compliance(Vas, Sd) {
  const s = Sd * 1e-4
  return (Vas * 1e-3) / (K * s * s)
}

function equivalentVolume(Cms, Sd) {
  const s = Sd * 1e-4
  return Cms * K * s * s * 1e3
}

function fsFromMmsCms(a) {
  return 1 / (TAU * Math.sqrt(a.Mms * 1e-3 * a.Cms * 1e-3))
}

function fsFromMmsVas(a, c) {
  return 1 / (TAU * Math.sqrt(a.Mms * 1e-3 * compliance(c.Vas, c.Sd)))
}

function reFromZmax(a, c) {
  return a.Zmax / (1 + c.Qms / c.Qes)
}

function reFromZnom(a) {
  return 0.85 * a.Znom
}

function sdFromDiameter(a) {
  return (Math.PI * a.Dia * a.Dia) / 4
}

function sdFromVasCms(a, c) {
  return Math.sqrt((c.Vas * 1e-3) / (K * a.Cms * 1e-3)) * 1e4
}

function qesFromQtsQms(a, c) {
  if (a.Qts >= c.Qms) throw new Error('Qts must be lower than Qms — check which figure is which.')
  return (a.Qts * c.Qms) / (c.Qms - a.Qts)
}

function qesFromBlMms(a, c) {
  return (TAU * c.Fs * a.Mms * 1e-3 * c.Re) / (a.Bl * a.Bl)
}

function qmsFromQtsQes(a, c) {
  if (a.Qts >= c.Qes) throw new Error('Qts must be lower than Qes — check which figure is which.')
  return (a.Qts * c.Qes) / (c.Qes - a.Qts)
}

function qmsFromRmsMms(a, c) {
  return (TAU * c.Fs * a.Mms * 1e-3) / a.Rms
}

function vasFromCms(a, c) {
  return equivalentVolume(a.Cms * 1e-3, c.Sd)
}

function vasFromMms(a, c) {
  const ws = TAU * c.Fs
  return equivalentVolume(1 / (ws * ws * a.Mms * 1e-3), c.Sd)
}

export const CORE = [
  { key: 'Fs', label: 'Fs (free air)', unit: 'Hz' },
  { key: 'Re', label: 'Re', unit: 'Ω' },
  { key: 'Sd', label: 'Sd', unit: 'cm²' },
  { key: 'Qes', label: 'Qes', unit: '' },
  { key: 'Qms', label: 'Qms', unit: '' },
  { key: 'Vas', label: 'Vas', unit: 'L' },
]

export const ALTS = {
  Fs: [
    {
      id: 'MmsCms', label: 'Mms and Cms', formula: 'Fs = 1 / (2π√(Mms·Cms))',
      inputs: [['Mms', 'Mms', 'g'], ['Cms', 'Cms', 'mm/N']], needs: [], solve: fsFromMmsCms,
    },
    {
      id: 'MmsVas', label: 'Mms (with Vas and Sd)', formula: 'Cms = Vas / (ρc²·Sd²), Fs = 1 / (2π√(Mms·Cms))',
      inputs: [['Mms', 'Mms', 'g']], needs: ['Vas', 'Sd'], solve: fsFromMmsVas,
    },
  ],
  Re: [
    {
      id: 'Zmax', label: 'impedance peak Zmax', formula: 'Re = Zmax / (1 + Qms/Qes)',
      inputs: [['Zmax', 'Zmax', 'Ω']], needs: ['Qms', 'Qes'], solve: reFromZmax,
    },
    {
      id: 'Znom', label: 'nominal impedance (estimate)', formula: 'Re ≈ 0.85·Znom',
      inputs: [['Znom', 'Nominal Z', 'Ω']], needs: [], solve: reFromZnom, estimate: true,
    },
  ],
  Sd: [
    {
      id: 'Dia', label: 'effective diameter', formula: 'Sd = π·D² / 4',
      inputs: [['Dia', 'Eff. diameter', 'cm']], needs: [], solve: sdFromDiameter,
    },
    {
      id: 'VasCms', label: 'Cms (with Vas)', formula: 'Sd = √(Vas / (ρc²·Cms))',
      inputs: [['Cms', 'Cms', 'mm/N']], needs: ['Vas'], solve: sdFromVasCms,
    },
  ],
  Qes: [
    {
      id: 'QtsQms', label: 'Qts (with Qms)', formula: 'Qes = Qts·Qms / (Qms − Qts)',
      inputs: [['Qts', 'Qts', '']], needs: ['Qms'], solve: qesFromQtsQms,
    },
    {
      id: 'BlMms', label: 'Bl and Mms', formula: 'Qes = 2πFs·Mms·Re / Bl²',
      inputs: [['Bl', 'Bl', 'T·m'], ['Mms', 'Mms', 'g']], needs: ['Fs', 'Re'], solve: qesFromBlMms,
    },
  ],
  Qms: [
    {
      id: 'QtsQes', label: 'Qts (with Qes)', formula: 'Qms = Qts·Qes / (Qes − Qts)',
      inputs: [['Qts', 'Qts', '']], needs: ['Qes'], solve: qmsFromQtsQes,
    },
    {
      id: 'RmsMms', label: 'Rms and Mms', formula: 'Qms = 2πFs·Mms / Rms',
      inputs: [['Rms', 'Rms', 'kg/s'], ['Mms', 'Mms', 'g']], needs: ['Fs'], solve: qmsFromRmsMms,
    },
  ],
  Vas: [
    {
      id: 'Cms', label: 'Cms (with Sd)', formula: 'Vas = ρc²·Sd²·Cms',
      inputs: [['Cms', 'Cms', 'mm/N']], needs: ['Sd'], solve: vasFromCms,
    },
    {
      id: 'Mms', label: 'Mms (with Fs and Sd)', formula: 'Cms = 1 / ((2πFs)²·Mms), Vas = ρc²·Sd²·Cms',
      inputs: [['Mms', 'Mms', 'g']], needs: ['Fs', 'Sd'], solve: vasFromMms,
    },
  ],
}

const FORMULAS = {
  Cms: 'Cms = Vas / (ρc²·Sd²)',
  Mms: 'Mms = 1 / ((2πFs)²·Cms)',
  Bl: 'Bl = √(2πFs·Mms·Re / Qes)',
  Rms: 'Rms = 2πFs·Mms / Qms',
  Qts: 'Qts = Qes·Qms / (Qes + Qms)',
}

function solveDatasheet({ Fs, Vas, Qes, Qms, Re, Sd }) {
  const Cms = compliance(Vas, Sd)
  const ws = TAU * Fs
  const Mms = 1 / (ws * ws * Cms)
  const Bl = Math.sqrt((ws * Mms * Re) / Qes)
  const Rms = (ws * Mms) / Qms
  const Qts = (Qes * Qms) / (Qes + Qms)
  return { Fs, Vas, Qes, Qms, Qts, Re, Sd, Cms: Cms * 1e3, Mms: Mms * 1e3, Bl, Rms }
}

function altFor(key, id) {
  return ALTS[key].find((x) => x.id === id) || ALTS[key][0]
}

export function solveTS(values, missing) {
  const core = {}
  const via = {}
  let estimated = false

  const pending = []
  for (const { key, label } of CORE) {
    if (missing[key]) { pending.push(key); continue }
    const v = values[key]
    if (!isFinite(v) || v <= 0) throw new Error(`${label} must be a positive number.`)
    core[key] = v
    via[key] = 'given'
  }

  while (pending.length) {
    const before = pending.length
    for (let i = pending.length - 1; i >= 0; i--) {
      const key = pending[i]
      const alt = altFor(key, missing[key])
      if (!alt.needs.every((n) => n in core)) continue
      for (const [name, label, unit] of alt.inputs) {
        const v = values[`${key}_${name}`]
        if (!isFinite(v) || v <= 0) {
          throw new Error(`${label}${unit ? ` (${unit})` : ''}, standing in for ${key}, must be a positive number.`)
        }
      }
      const a = Object.fromEntries(alt.inputs.map(([name]) => [name, values[`${key}_${name}`]]))
      const v = alt.solve(a, core)
      if (!isFinite(v) || v <= 0) throw new Error(`${key} worked out to ${v} — check the figures standing in for it.`)
      core[key] = v
      via[key] = alt.formula
      if (alt.estimate) estimated = true
      pending.splice(i, 1)
    }
    if (pending.length === before) {
      throw new Error(
        `${pending.join(' and ')} can only be worked out from each other. `
        + 'At least one of them has to come off the datasheet, or from a route that does not need the others.',
      )
    }
  }

  return { result: solveDatasheet(core), via, estimated }
}

const num = { valueAsNumber: true }

function Field({ name, label, unit, register, children }) {
  return (
    <div className="param-row">
      <label>{label}</label>
      <input type="number" step="any" {...register(name, num)} />
      <span className="unit">{unit}</span>
      {children}
    </div>
  )
}

export default function TSCalc() {
  const show = useStore((s) => s.showTSCalc)
  const setShow = useStore((s) => s.setShowTSCalc)
  const node = useStore((s) => s.nodes.find((n) => n.id === s.selectedNodeId))
  const applyDriverParams = useStore((s) => s.applyDriverParams)
  const [missing, setMissing] = useState({})
  const [solved, setSolved] = useState(null)
  const [error, setError] = useState(null)
  const { register, handleSubmit } = useForm({
    defaultValues: {
      Fs: 30, Re: 3.6, Sd: 480, Qes: 0.5, Qms: 5, Vas: 60,
      Fs_Mms: 85, Fs_Cms: 0.33,
      Re_Zmax: 40, Re_Znom: 4,
      Sd_Dia: 24.7, Sd_Cms: 0.33,
      Qes_Qts: 0.45, Qes_Bl: 12, Qes_Mms: 85,
      Qms_Qts: 0.45, Qms_Rms: 3.2, Qms_Mms: 85,
      Vas_Cms: 0.33, Vas_Mms: 85,
    },
  })

  const dismiss = useBackdropDismiss(() => setShow(false))
  if (!show) return null

  const setMissingFlag = (key, on) => {
    setMissing((m) => {
      const next = { ...m }
      if (on) next[key] = ALTS[key][0].id
      else delete next[key]
      return next
    })
    setSolved(null)
    setError(null)
  }

  const setAlt = (key, id) => {
    setMissing((m) => ({ ...m, [key]: id }))
    setSolved(null)
    setError(null)
  }

  const onSolve = handleSubmit((v) => {
    setError(null)
    try {
      setSolved(solveTS(v, missing))
    } catch (e) {
      setSolved(null)
      setError(e.message)
    }
  })

  const applyToNode = () => {
    if (!solved) return
    if (!node || node.type !== 'driver') { alert('Select a Driver node first.'); return }
    const patch = {}
    for (const k of ['Fs', 'Vas', 'Qes', 'Qms', 'Qts', 'Re', 'Sd', 'Cms', 'Mms', 'Bl', 'Rms']) {
      const v = solved.result[k]
      if (v != null && isFinite(v)) patch[k] = Math.round(v * 1000) / 1000
    }
    applyDriverParams(node.id, patch)
    setShow(false)
  }

  const renderRow = ({ key, label, unit }) => {
    const check = (
      <label className="ts-missing" title={`Tick if ${key} is not on the datasheet`}>
        <input
          type="checkbox" checked={!!missing[key]}
          onChange={(e) => setMissingFlag(key, e.target.checked)}
        />
        missing
      </label>
    )
    if (!missing[key]) {
      return <Field key={key} name={key} label={label} unit={unit} register={register}>{check}</Field>
    }
    const alt = altFor(key, missing[key])
    return (
      <div className="ts-sub" key={key}>
        <div className="param-row">
          <label>{label}</label>
          <select value={alt.id} onChange={(e) => setAlt(key, e.target.value)}>
            {ALTS[key].map((o) => <option key={o.id} value={o.id}>from {o.label}</option>)}
          </select>
          <span className="unit" />
          {check}
        </div>
        {alt.inputs.map(([name, lab, u]) => (
          <Field key={name} name={`${key}_${name}`} label={lab} unit={u} register={register}>
            <span className="ts-spacer" />
          </Field>
        ))}
        <div className="ts-formula">{alt.formula}</div>
      </div>
    )
  }

  const rows = solved && [
    ['Mms', 'g', FORMULAS.Mms], ['Cms', 'mm/N', FORMULAS.Cms], ['Bl', 'T·m', FORMULAS.Bl],
    ['Rms', 'kg/s', FORMULAS.Rms], ['Qts', '', FORMULAS.Qts],
  ].filter(([k]) => isFinite(solved.result[k]))

  return (
    <div className="modal-backdrop" {...dismiss}>
      <div className="modal">
        <h3>T/S Parameter Solver</h3>
        <p className="ts-lead">
          Enter what the datasheet gives you. Tick <em>missing</em> on anything it
          leaves out and pick a published figure to recover it from instead.
        </p>
        {CORE.map(renderRow)}
        <button className="primary" onClick={onSolve} style={{ marginTop: 8 }}>Solve</button>
        {error && <div className="ts-error">{error}</div>}
        {solved && (
          <>
            {solved.estimated && (
              <div className="ts-note">
                One figure is an estimate rather than a derivation — treat the
                result as a starting point and check it against a measurement.
              </div>
            )}
            <table style={{ marginTop: 10 }}>
              <tbody>
                <tr className="ts-head"><td colSpan={3}>Parameters</td></tr>
                {CORE.map(({ key, unit }) => (
                  <tr key={key} title={solved.via[key]}>
                    <td>{key}</td>
                    <td><b>{solved.result[key].toFixed(3)}</b> {unit}</td>
                    <td className="ts-src">
                      {solved.via[key] === 'given' ? 'given' : solved.via[key]}
                    </td>
                  </tr>
                ))}
                {rows.length > 0 && <tr className="ts-head"><td colSpan={3}>Derived</td></tr>}
                {rows.map(([k, unit, formula]) => (
                  <tr key={k} className="ts-derived" title={formula}>
                    <td>{k}</td>
                    <td><b>{solved.result[k].toFixed(3)}</b> {unit}</td>
                    <td className="ts-src">{formula}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <div className="close-row">
          <button onClick={() => setShow(false)}>Close</button>
          <button className="primary" disabled={!solved} onClick={applyToNode}>Apply to driver</button>
        </div>
      </div>
    </div>
  )
}

export const __internals = { solveDatasheet, altFor, compliance, equivalentVolume }
