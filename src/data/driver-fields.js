export const CORE_FIELDS = [
  { key: 'Fs', label: 'Fs', unit: 'Hz', type: 'number', solver: true },
  { key: 'Qts', label: 'Qts', unit: '', type: 'number' },
  { key: 'Qes', label: 'Qes', unit: '', type: 'number' },
  { key: 'Qms', label: 'Qms', unit: '', type: 'number' },
  { key: 'Vas', label: 'Vas', unit: 'L', type: 'number' },
  { key: 'Re', label: 'Re', unit: 'Ω', type: 'number', solver: true },
  { key: 'Bl', label: 'Bl', unit: 'T·m', type: 'number', solver: true },
  { key: 'Mms', label: 'Mms', unit: 'g', type: 'number', solver: true },
  { key: 'Cms', label: 'Cms', unit: 'mm/N', type: 'number', solver: true },
  { key: 'Sd', label: 'Sd', unit: 'cm²', type: 'number', solver: true },
  { key: 'Le', label: 'Le', unit: 'mH', type: 'number', solver: true },
  { key: 'Xmax', label: 'Xmax', unit: 'mm', type: 'number', solver: true },
  { key: 'Rms', label: 'Rms', unit: 'N·s/m', type: 'number', solver: true },
]

export const EXT_FIELDS = [
  { key: 'Xvar', group: 'Excursion', label: 'Xvar', unit: 'mm', type: 'number',
    desc: 'Maximum linear-plus-suspension travel before damage, one way.' },
  { key: 'Xmech', group: 'Excursion', label: 'Xmech', unit: 'mm', type: 'number',
    desc: 'Hard mechanical limit, one way.' },
  { key: 'Vd', group: 'Excursion', label: 'Vd', unit: 'L', type: 'number',
    desc: 'Peak displacement volume, Sd · Xmax.' },
  { key: 'eta0', group: 'Excursion', label: 'η₀', unit: '%', type: 'number',
    desc: 'Reference half-space efficiency.' },

  { key: 'Znom', group: 'Electrical', label: 'Nominal impedance', unit: 'Ω', type: 'number' },
  { key: 'Zmin', group: 'Electrical', label: 'Minimum impedance', unit: 'Ω', type: 'number' },
  { key: 'Leb', group: 'Electrical', label: 'Le @ 1 kHz', unit: 'mH', type: 'number' },
  { key: 'pNom', group: 'Electrical', label: 'Nominal power', unit: 'W', type: 'number',
    desc: 'AES / RMS rating.' },
  { key: 'pCont', group: 'Electrical', label: 'Continuous power', unit: 'W', type: 'number',
    desc: 'Program power, typically 2× nominal.' },
  { key: 'sens', group: 'Electrical', label: 'Sensitivity', unit: 'dB', type: 'number',
    desc: '1 W / 1 m, half space.' },

  { key: 'vcDia', group: 'Motor', label: 'Voice coil diameter', unit: 'mm', type: 'number' },
  { key: 'vcDepth', group: 'Motor', label: 'Winding depth', unit: 'mm', type: 'number' },
  { key: 'gapDepth', group: 'Motor', label: 'Magnetic gap depth', unit: 'mm', type: 'number' },
  { key: 'flux', group: 'Motor', label: 'Flux density', unit: 'T', type: 'number' },
  { key: 'vcWinding', group: 'Motor', label: 'Winding material', unit: '', type: 'text' },
  { key: 'vcFormer', group: 'Motor', label: 'Former material', unit: '', type: 'text' },
  { key: 'magnet', group: 'Motor', label: 'Magnet material', unit: '', type: 'text' },
  { key: 'pole', group: 'Motor', label: 'Pole design', unit: '', type: 'text' },
  { key: 'spider', group: 'Construction', label: 'Spider', unit: '', type: 'text' },
  { key: 'surround', group: 'Construction', label: 'Surround shape', unit: '', type: 'text' },
  { key: 'cone', group: 'Construction', label: 'Cone shape', unit: '', type: 'text' },

  { key: 'dia', group: 'Application', label: 'Nominal diameter', unit: 'mm', type: 'number' },
  { key: 'EBP', group: 'Application', label: 'EBP', unit: 'Hz', type: 'number',
    desc: 'Efficiency bandwidth product, Fs / Qes.' },
  { key: 'fLow', group: 'Application', label: 'Range low', unit: 'Hz', type: 'number' },
  { key: 'fHigh', group: 'Application', label: 'Range high', unit: 'Hz', type: 'number' },
  { key: 'vRec', group: 'Application', label: 'Recommended enclosure', unit: 'L', type: 'number' },
  { key: 'fRec', group: 'Application', label: 'Recommended tuning', unit: 'Hz', type: 'number' },
  { key: 'mass', group: 'Application', label: 'Net weight', unit: 'kg', type: 'number' },
]

export const EXT_BY_KEY = Object.fromEntries(EXT_FIELDS.map((f) => [f.key, f]))
export const EXT_GROUPS = [...new Set(EXT_FIELDS.map((f) => f.group))]

export function driverToParams(d) {
  const p = { label: d.model }
  for (const f of CORE_FIELDS) if (d[f.key] != null) p[f.key] = d[f.key]
  p.Znom = Number(d.Znom ?? d.ext?.Znom) > 0 ? Number(d.Znom ?? d.ext.Znom) : null
  return p
}

export function formatExt(key, value) {
  const f = EXT_BY_KEY[key]
  if (!f || value == null || value === '') return null
  return f.unit ? `${value} ${f.unit}` : String(value)
}
