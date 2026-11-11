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
  directive, globe and the "Här är du" panel with the street view. The globe,
  the directive and the street view follow the shared timeline in
  `www/lib/timeline.ts`, which plays the whole trip in real time once space
  has set it off. `S` steps the speed
  up through 100x to 10000000x and back to real time. The last leg, from
  Slussen to the destination, is capped at 300x.
- The street legs in Stockholm (`www/lib/streetLegs.ts`) go from the origin to
  an exit, on to the nearest jetty, and at the end from Slussen to the
  destination.
- The street view is a mocked voxel scene (`www/components/streetScene.ts`)
  that takes its terrain from the globe under the traveller.
- **`/globe`** — standalone demo on its own clock, keyboard only
  (space, arrow keys, `+`/`-`, `N`/`B`, `F`, `R`, `C`).
- **`/globe/assets`** — contact sheet of every voxel model.
- The globe has six detail levels, one per zoom step. `globeLod.ts` in
  `www/components/globe` blends between them as the camera moves.
- The trip opens on a close-up of Stockholm with the two addresses flagged A
  and B. When the journey starts the camera pulls back to the globe and the
  flags follow along. On the way out the city gives way to three ever coarser
  levels of the land around it, and those to the detail levels of the globe,
  which has a cut-out where they lie. The city is a hand-drawn voxel map in
  `www/lib/city`, the land around it comes from `region.ts` there, and
  `cityIntro.ts` in `www/components/globe` lets them into the globe.
- The walker, the swimmer, the raft, the ride-on mower and the moonwalker have
  a loop of poses each (`sequence` on the model). `www/lib/voxel/posed.ts`
  plays it on the globe and in the street view while the traveller moves. The
  thumbnails and `/globe/assets` show the still pose.
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
