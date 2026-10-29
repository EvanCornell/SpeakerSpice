export const SCHEMA_VERSION = 3

export const DEFAULT_PARAMS = {
  driver: {
    Fs: 30, Qts: 0.45, Qes: 0.5, Qms: 5, Vas: 60, Re: 3.6, Bl: 15, Mms: 150,
    Cms: 0.19, Sd: 480, Le: 1.5, LeExp: 1, Xmax: 15, Rms: 4,
    count: 1, wiring: 'parallel', dvc: null, label: 'Driver',
  },
  chamber: {
    volume: 30, length: 40, shape: 'rectangular', stuffing: 0,
    leakQL: null, leakHz: 30, taps: [], label: 'Chamber',
  },
  waveguide: {
    S1: 80, S2: 80, length: 30, flare: 'conical', ecFactor: 1,
    loss: 1, throatK: 0.5, mouthK: 0.5, taps: [], label: 'Port',
  },
  pr: { Mmd: 85, Cms: 0.35, Rms: 3, Sd: 480, addedMass: 0, count: 1, label: 'Passive Radiator' },
  radiation: { space: 'half', label: 'Radiation' },
}

export const NODE_HANDLES = {
  driver: ['front', 'rear'],
  chamber: ['in', 'out'],
  waveguide: ['throat', 'mouth'],
  pr: ['front', 'rear'],
  radiation: ['in'],
}

export const DEFAULT_ANALYSIS = {
  id: 'sweep', type: 'ac', fmin: 10, fmax: 1000, npts: 512, masking: false,
}

export const DEFAULT_CHANNEL = { id: 'ch1', label: 'Channel', volts: 2.83, ohms: 8, outputOhms: 0 }

export const DEFAULT_WIRING = { masterDb: 0, toolbar: 'ch1', channels: [DEFAULT_CHANNEL], wires: [], layout: {} }

export const DEFAULT_DISPLAY = {
  vThreshold: 17, unwrapPhase: true, delayOffset: 0, nominalOhms: 4,
}

export const PROBE_KINDS = ['pressure', 'flow', 'velocity']

export const DEFAULT_AIR = { temperatureC: 20, altitudeM: 0 }
