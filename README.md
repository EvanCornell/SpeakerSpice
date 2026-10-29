# SpeakerSpice

Loudspeaker enclosure design on a free-form node graph. Drivers, chambers,
waveguides, passive radiators and radiation loads are wired together on a
canvas, and the whole system is simulated as one circuit by ngspice, running
in your browser.

Everything runs client-side. Projects are stored in your browser.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Build

```bash
npm run build
```

`dist/` is a static site. Serve it from any static host — Netlify,
Cloudflare Pages, GitHub Pages — including from a subdirectory.
`public/_redirects` and the generated `404.html` handle page routing on those
hosts.

## Licence

MIT — see [LICENSE](LICENSE). Third-party software, including ngspice, is
credited in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
