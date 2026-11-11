# Pointless travel planner

> **Hackaton** — a Next.js app built on the [Äventyret rig](https://github.com/Aventyret/aventyret-rig).

This is a travel planner that visualizes absurldy bad travel directions between to addresses in Stockholm, Sweden.

The service will always choose a ridiculously long direction (globally). Not always the longest but always something very long.

We want to rely heavily on 3d rendered UI (rendered with three.js). The directions should be visualized with a 3d renederd image of earth.

## Codebase description

Hackaton is a Next.js (App Router) frontend served as the `www` service through
the rig. It is the starting base for the hackathon project — build on top of it
in `www/app`.

- **Stack:** `nextjs` (rig release 2.38.0) · **Service:** `www`
- **Local URL:** https://www.hackaton.test
- **Repo:** https://github.com/Aventyret-Hackaton/hackaton
  (clone: `gh repo clone Aventyret-Hackaton/hackaton`)
- **App code:** `www/app` — pages, layouts, components
- **Env:** `.env.template` + `.env.rig`, generated into `.env` by `rig env`

### Voxel globe

- **`/trip`** uses the voxel interface for the whole view: title bar, travel
  directive, globe and the "Här är du" panel with the street view. The globe
  and the directive follow the shared timeline in `www/lib/timeline.ts`.
- **`/globe`** — standalone demo on its own clock, keyboard only
  (space, arrow keys, `+`/`-`, `N`/`B`, `F`, `R`, `C`).
- **`/globe/assets`** — contact sheet of every voxel model.
- **Code:** scene and components in `www/components/globe`, voxel engine and
  models in `www/lib/voxel`, route and sights in `www/lib/globe/journey.ts`.
- `www/components/TripGlobe.tsx` is no longer used.


<!-- rig:start -->
<!-- Written by 'rig self update'. Change it in the rig, not here. -->

## Getting started locally

The site runs on your computer with [the rig](https://github.com/Aventyret/aventyret-rig).
If your computer is not set up yet, start with [GETTING_STARTED.md](https://github.com/Aventyret/aventyret-rig/blob/main/docs/GETTING_STARTED.md).

**The first time:** get the repo and set up the site.

```bash
gh repo clone Aventyret/hackaton
cd hackaton
rig setup
```

**Every time you work on the site:** start it. `Ctrl + C` stops it again.

```bash
rig up
```

The site is then available at:

- **www** — https://www.hackaton.test, https://hackaton.test

For daily work, `rig up`, `rig down`, `rig logs` and
`rig doctor` are enough. `rig help` lists everything you can do in this
particular site, and [CHEATSHEET.md](https://github.com/Aventyret/aventyret-rig/blob/main/docs/CHEATSHEET.md) is the everyday reference.

<!-- rig:end -->
