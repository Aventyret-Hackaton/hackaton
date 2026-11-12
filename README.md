# Pointless travel planner

> A travel planner that gives you the worst possible directions between two Stockholm addresses — gloriously, globally, on purpose.

## The game

Pick where you are and where you want to go in Stockholm, hit **Starta omvägen** ("start the detour"), and the planner flatly refuses to take you there in any sensible way. Instead it commits — hard — to the single worst idea it has: it sends you the *long* way around the planet.

What follows is the whole pointless odyssey, played out on a living voxel world: out of the city, down to a jetty, onto a boat, across oceans and deserts by every vehicle imaginable, and eventually back to Slussen for the last stretch home. Days tick by. You can sit back and watch it in real time, or fast-forward through the absurdity. It is a travel planner with exactly one, deeply committed bad idea.

Try it out: https://pointless-travel-planner.vercel.app/

## What we brought to life

The concept was simple and stubborn: *a route planner that is always magnificently wrong.* The ideas we built around it:

- **Always the long way round.** The planner never picks the sensible route — it picks a ridiculously long way around the globe, every time.
- **A hand-built voxel world.** The entire UI is rendered in 3D with three.js. We wrote our own little voxel engine (grid → mesher → models) rather than using sprites or pre-made assets.
- **A start screen that's alive.** The landing page is a voxel diorama with wandering characters, a taxi on the road, a metro easing out of the tunnel, a swan pedal-boat on the river, a rocket, drifting clouds and a pixel sun.
- **The journey, visualized.** The trip plays out on a voxel globe that pulls back from a hand-drawn close-up of Stockholm all the way out to the planet, with a street-level *"Här är du"* view kept in sync, step by step.
- **A timeline you control.** Watch it unfold in real time, or press `S` to skip from 100× up to 10,000,000× and back.
- **Deadpan Swedish copy** and arcade styling throughout, to sell the joke.
- **Sound.** A looping theme — calm while you plan, upbeat once you depart, and nudged faster as you speed the journey up — plus arcade UI sound effects.

## How we built it

- Built during a hackathon on top of the **[Äventyret rig](https://github.com/Aventyret/aventyret-rig)**, our Docker/Traefik-based dev platform, as a **Next.js (App Router)** app.
- A **three.js voxel engine** written from scratch under `www/lib/voxel`, with models for people, vehicles, boats, sights and scenery.
- **Google Places** powers the Stockholm address autocomplete.
- We worked in parallel on feature branches and merged through **pull requests**, iterating quickly on the feel — the start scene, the globe's levels of detail, the Stockholm close-up, and the audio.
- Accessibility kept in mind throughout: `prefers-reduced-motion` stops the animation, the audio can be muted, and nothing relies on sound alone.

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

### Start view

- **`/`** — the form sits on a voxel scene (`www/components/startBackdrop.ts`)
  that recreates the old background picture, `www/public/start-bg.png`, which
  is no longer shown. Places in the scene are given as pixels of that picture
  (`www/lib/start/frame.ts`), so the panel stays over the same spot. The scene
  fills the window, and wider or taller windows see more of it.
- The people, the taxi, the metro, the swan boat, the rocket, the sun, the
  clouds and the river move. With reduced motion the scene stands still.
- The name is voxel text on a layer of its own in front of the hills. The
  camera follows the pointer a little and drifts by itself, which sets the
  layers apart.
- **Code:** models in `www/lib/start`, the ground with the road, the rails and
  the river in `www/lib/start/ground.ts`. Without WebGL the view shows a plain
  sky and the name as text.

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
- The globe shows the same traveller as the street view: on foot on the street
  legs in Stockholm, the vehicle of the leg in between, and nobody after
  arrival.
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
- The close-up is alive: ripples drift over the water, vessels sail loops
  (`www/lib/city/harbour.ts`) and gulls circle over the middle of the view
  (`www/components/globe/cityLife.ts`). They dissolve with the city when the
  camera pulls back, and stand still with reduced motion.
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
