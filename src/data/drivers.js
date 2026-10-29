import { DRIVERS } from './drivers.library.js'
import { CORE_FIELDS, EXT_FIELDS, EXT_BY_KEY, EXT_GROUPS, driverToParams } from './driver-fields.js'

export { CORE_FIELDS, EXT_FIELDS, EXT_BY_KEY, EXT_GROUPS, driverToParams }

const normalize = (d) => ({ ...d, ext: d.ext || {}, name: `${d.brand} ${d.model}` })

export const BUILTIN_DRIVERS = DRIVERS
  .map(normalize)
  .sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model))

export const DRIVER_BRANDS = [...new Set(BUILTIN_DRIVERS.map((d) => d.brand))].sort()

export const POPULATED_EXT_KEYS = EXT_FIELDS
  .map((f) => f.key)
  .filter((k) => BUILTIN_DRIVERS.some((d) => d.ext[k] != null))
