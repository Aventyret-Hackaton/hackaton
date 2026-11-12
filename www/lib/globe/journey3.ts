import type { LatLon } from './geo';
import { type Journey, type Leg, type Sight, STOCKHOLM } from './journey';

const TORE: LatLon = [65.9, 22.65];
const NORTH_CAPE: LatLon = [71.17, 25.78];
const LONGYEARBYEN: LatLon = [78.22, 15.63];
const NORTH_POLE: LatLon = [90, 0];
const UTQIAGVIK: LatLon = [71.29, -156.79];
const HALIFAX: LatLon = [44.65, -63.57];
const TRONDHEIM: LatLon = [63.43, 10.4];
const SUNDSVALL: LatLon = [62.39, 17.31];

// Latitude of the lap around the pole, one corner for every 45 degrees.
const LAP_LATITUDE = 88;
const POLE_LAP: readonly LatLon[] = [0, 45, 90, 135, 180, -135, -90, -45, 0].map((longitude): LatLon => [LAP_LATITUDE, longitude]);

// North to the pole, once around it, and home by way of Alaska.
const LEGS: readonly Leg[] = [
  {
    id: 'bothnia',
    modelId: 'flamingo',
    mode: 'Badflamingo',
    from: 'Slussen',
    to: 'Töre',
    instruction: 'Flyt norrut tills Östersjön tar slut. Det gör den i Töre.',
    startDay: 1,
    path: [STOCKHOLM, [59.45, 18.9], [60.1, 19.2], [61.5, 19.6], [63.5, 20.9], [64.8, 22.6], TORE]
  },
  {
    id: 'lapland',
    modelId: 'scooter',
    mode: 'Elsparkcykel',
    from: 'Töre',
    to: 'Nordkap',
    instruction: 'Batteriet tål inte kyla. Sparka resten.',
    startDay: 36,
    path: [TORE, [67.21, 23.37], [68.44, 22.48], [69.97, 23.27], NORTH_CAPE]
  },
  {
    id: 'barents',
    modelId: 'swan',
    mode: 'Svantrampbåt',
    from: 'Nordkap',
    to: 'Longyearbyen',
    instruction: 'Trampa över Barents hav. Svanen är inte isklassad.',
    startDay: 42,
    path: [NORTH_CAPE, [74.3, 18.2], [76.3, 14.0], [78.05, 12.8], LONGYEARBYEN]
  },
  {
    id: 'pack-ice',
    modelId: 'mower',
    mode: 'Åkgräsklippare',
    from: 'Longyearbyen',
    to: 'Nordpolen',
    instruction: 'Klipp norrut. Isen växer inte. Klipp den ändå.',
    startDay: 72,
    path: [LONGYEARBYEN, [80.2, 16.0], [85.0, 16.0], NORTH_POLE]
  },
  {
    id: 'pole-lap',
    modelId: 'moonwalker',
    mode: 'Moonwalk',
    from: 'Nordpolen',
    to: 'Nordpolen',
    instruction: 'Ett varv runt polen. Baklänges genom alla tidszoner.',
    startDay: 93,
    path: [NORTH_POLE, ...POLE_LAP, NORTH_POLE]
  },
  {
    id: 'arctic-ocean',
    modelId: 'swimmer',
    mode: 'Simtur',
    from: 'Nordpolen',
    to: 'Utqiaġvik',
    instruction: 'Simma söderut. Alla håll är söderut. Välj fel.',
    startDay: 180,
    path: [NORTH_POLE, [80.0, -160.0], UTQIAGVIK]
  },
  {
    id: 'canada',
    modelId: 'bus',
    mode: 'Ersättningsbuss 43Y',
    from: 'Utqiaġvik',
    to: 'Halifax',
    instruction: 'Ersätter 43X. Går via Kanada av tekniska skäl.',
    startDay: 285,
    path: [
      UTQIAGVIK,
      [64.84, -147.72],
      [60.72, -135.05],
      [53.55, -113.49],
      [49.9, -97.14],
      [48.38, -89.25],
      [47.99, -84.77],
      [46.49, -81.0],
      [45.42, -75.7],
      [46.81, -71.21],
      [47.37, -68.33],
      [46.09, -64.78],
      HALIFAX
    ]
  },
  {
    id: 'gulf-stream',
    modelId: 'raft',
    mode: 'Flotte',
    from: 'Halifax',
    to: 'Trondheim',
    instruction: 'Driv med Golfströmmen. Den vet vägen, ungefär.',
    startDay: 325,
    path: [HALIFAX, [45.0, -50.0], [54.0, -25.0], [61.3, -4.5], [63.7, 7.5], [63.75, 9.6], TRONDHEIM]
  },
  {
    id: 'pilgrim-trail',
    modelId: 'walker',
    mode: 'Promenad',
    from: 'Trondheim',
    to: 'Sundsvall',
    instruction: 'Pilgrimsleden, åt fel håll. Möt alla pilgrimer.',
    startDay: 537,
    path: [TRONDHEIM, [63.8, 11.56], [63.4, 13.08], [63.18, 14.64], [62.75, 15.42], SUNDSVALL]
  },
  {
    id: 'pulp-freight',
    modelId: 'ship',
    mode: 'Containerfartyg',
    from: 'Sundsvall',
    to: 'Slussen',
    instruction: 'Lifta med pappersmassan. Samma vatten som dag 1. Hoppa av vid Slussen.',
    startDay: 556,
    path: [SUNDSVALL, [62.3, 18.3], [60.6, 18.7], [60.1, 19.2], [59.45, 18.9], STOCKHOLM]
  }
];

// Invented, deliberately dull stops. None of them refer to a real place.
const SIGHTS: readonly Sight[] = [
  {
    id: 'cold-wave',
    name: 'Kall våg',
    modelId: 'wave',
    position: [62.2, 20.6]
  },
  {
    id: 'pleased-buoy',
    name: 'Boj, nöjd med sitt läge',
    modelId: 'buoy',
    position: [65.0, 24.0]
  },
  {
    id: 'frozen-charger',
    name: 'Laddstolpe, infrusen',
    modelId: 'charger',
    position: [68.6, 26.4]
  },
  {
    id: 'pole-sign',
    name: 'Skylt: Nordpolen rakt fram',
    modelId: 'signpost',
    position: [73.6, 25.0]
  },
  {
    id: 'bear-kiosk',
    name: 'Kiosk, stängd på grund av isbjörn',
    modelId: 'kiosk',
    position: [79.6, 8.0]
  },
  {
    id: 'ice-work',
    name: 'Isarbete, pågår till våren',
    modelId: 'roadwork',
    position: [83.6, 28.0]
  },
  {
    id: 'time-zones',
    name: 'Rondell med 24 tidszoner',
    modelId: 'roundabout',
    position: [86.0, 70.0]
  },
  {
    id: 'santa-office',
    name: 'Tomtens kontor, semesterstängt',
    modelId: 'office',
    position: [86.0, -100.0]
  },
  {
    id: 'ice-hole-queue',
    name: 'Väntkö till isvaken',
    modelId: 'queue',
    position: [79.0, -146.0]
  },
  {
    id: 'far-shelter',
    name: 'Busskur, 400 mil till nästa',
    modelId: 'shelter',
    position: [58.6, -127.0]
  },
  {
    id: 'spruce-view',
    name: 'Rastplats med utsikt över en gran',
    modelId: 'restStop',
    position: [53.0, -104.0]
  },
  {
    id: 'snowmobile-garage',
    name: 'Parkeringshus för snöskotrar, plan −3',
    modelId: 'garage',
    position: [50.4, -80.0]
  },
  {
    id: 'moose-gate',
    name: 'Tullgrind för älgar',
    modelId: 'gate',
    position: [48.8, -66.6]
  },
  {
    id: 'nothing-four',
    name: 'Ingenting, del 4',
    modelId: 'buoy',
    position: [48.0, -38.0]
  },
  {
    id: 'lukewarm',
    name: 'Golfströmmen, ljummen',
    modelId: 'wave',
    position: [59.4, -13.0]
  },
  {
    id: 'snowdrift',
    name: 'Snödriva, en av flera',
    modelId: 'dune',
    position: [64.4, 13.6]
  },
  {
    id: 'pilgrim-sign',
    name: 'Pilgrimsskylt, pekar bakåt',
    modelId: 'signpost',
    position: [61.8, 15.4]
  }
];

export const JOURNEY_3: Journey = { legs: LEGS, sights: SIGHTS, arrivalDay: 558 };
