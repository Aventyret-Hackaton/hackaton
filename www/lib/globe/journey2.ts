import type { LatLon } from './geo';
import { type Journey, type Leg, type Sight, STOCKHOLM } from './journey';

const GDANSK: LatLon = [54.4, 18.67];
const ISTANBUL: LatLon = [41.01, 28.98];
const CAIRO: LatLon = [30.04, 31.24];
const HORN_OF_AFRICA: LatLon = [11.8, 51.2];
const CAPE_TOWN: LatLon = [-33.92, 18.42];
const CAPE_HORN_EAST: LatLon = [-56.3, -66.0];
const CAPE_HORN_WEST: LatLon = [-56.2, -68.8];
const VALPARAISO: LatLon = [-33.03, -71.63];
const BUENOS_AIRES: LatLon = [-34.6, -58.38];
const KOPING: LatLon = [59.51, 16.0];

// South through Africa by land, to the wrong horn and the wrong cape, then round the right one.
const LEGS: readonly Leg[] = [
  {
    id: 'baltic',
    modelId: 'swan',
    mode: 'Svantrampbåt',
    from: 'Slussen',
    to: 'Gdańsk',
    instruction: 'Trampa över Östersjön. Lämna företräde åt Finlandsfärjan.',
    startDay: 1,
    path: [STOCKHOLM, [59.3, 18.95], [58.0, 19.7], [55.5, 19.2], GDANSK]
  },
  {
    id: 'replacement-bus-902',
    modelId: 'bus',
    mode: 'Ersättningsbuss 902',
    from: 'Gdańsk',
    to: 'Istanbul',
    instruction: 'Ersätter ett tåg som aldrig har gått. Byte i varje land.',
    startDay: 20,
    path: [GDANSK, [52.23, 21.01], [50.06, 19.94], [47.5, 19.04], [44.8, 20.47], [42.7, 23.32], ISTANBUL]
  },
  {
    id: 'levant',
    modelId: 'scooter',
    mode: 'Elsparkcykel',
    from: 'Istanbul',
    to: 'Kairo',
    instruction: 'Appen tillåter inte parkering här. Fortsätt till Kairo.',
    startDay: 29,
    path: [ISTANBUL, [39.93, 32.86], [37.0, 35.32], [36.2, 37.16], [33.51, 36.29], [31.95, 35.93], [29.53, 35.0], [29.97, 32.55], CAIRO]
  },
  {
    id: 'nile',
    modelId: 'moonwalker',
    mode: 'Moonwalk',
    from: 'Kairo',
    to: 'Afrikas horn',
    instruction: 'Backa uppför Nilen. Krokodilerna ser dig. Du ser inte dem.',
    startDay: 49,
    path: [CAIRO, [25.69, 32.64], [24.09, 32.9], [15.5, 32.56], [9.03, 38.74], [9.56, 44.06], [10.2, 47.5], [11.0, 50.3], HORN_OF_AFRICA]
  },
  {
    id: 'africa',
    modelId: 'mower',
    mode: 'Åkgräsklippare',
    from: 'Afrikas horn',
    to: 'Kapstaden',
    instruction: 'Fel horn. Klipp söderut tills Afrika tar slut.',
    startDay: 263,
    path: [HORN_OF_AFRICA, [9.0, 49.0], [2.5, 45.0], [-1.29, 36.82], [-6.16, 35.75], [-15.39, 28.32], [-20.15, 28.58], [-26.2, 28.05], CAPE_TOWN]
  },
  {
    id: 'south-atlantic',
    modelId: 'flamingo',
    mode: 'Badflamingo',
    from: 'Kapstaden',
    to: 'Kap Horn',
    instruction: 'Fel kap också. Flyt västerut mot rätt horn.',
    startDay: 380,
    path: [CAPE_TOWN, [-34.6, 17.6], [-37.6, -12.3], [-48.0, -45.0], [-54.8, -60.0], CAPE_HORN_EAST]
  },
  {
    id: 'cape-horn',
    modelId: 'swimmer',
    mode: 'Simtur',
    from: 'Kap Horn',
    to: 'Kap Horn, baksidan',
    instruction: 'Runda Kap Horn. Håll höger den här gången.',
    startDay: 650,
    path: [CAPE_HORN_EAST, [-56.7, -67.3], CAPE_HORN_WEST]
  },
  {
    id: 'chile',
    modelId: 'raft',
    mode: 'Flotte',
    from: 'Kap Horn, baksidan',
    to: 'Valparaíso',
    instruction: 'Driv norrut längs Chile. Landet tar inte slut.',
    startDay: 654,
    path: [CAPE_HORN_WEST, [-53.0, -76.5], [-45.0, -77.0], [-36.0, -74.5], VALPARAISO]
  },
  {
    id: 'andes',
    modelId: 'walker',
    mode: 'Promenad',
    from: 'Valparaíso',
    to: 'Buenos Aires',
    instruction: 'Gå över Anderna, tillbaka till Atlanten. Du var nyss där.',
    startDay: 769,
    path: [VALPARAISO, [-33.45, -70.67], [-32.89, -68.84], [-31.42, -64.18], [-32.95, -60.65], BUENOS_AIRES]
  },
  {
    id: 'atlantic-north',
    modelId: 'ship',
    mode: 'Containerfartyg',
    from: 'Buenos Aires',
    to: 'Köping',
    instruction: 'Lifta. Vinka åt Södertälje. Lasten ska till Köping.',
    startDay: 816,
    path: [
      BUENOS_AIRES,
      [-35.6, -55.0],
      [-23.0, -38.0],
      [-5.0, -30.0],
      [15.0, -28.0],
      [36.0, -14.0],
      [44.0, -10.5],
      [48.8, -6.2],
      [50.2, -1.0],
      [51.05, 1.5],
      [54.0, 5.0],
      [57.9, 10.7],
      [56.5, 11.8],
      [55.5, 12.75],
      [55.1, 14.2],
      [56.0, 17.2],
      [57.5, 17.6],
      [58.74, 17.87],
      [59.2, 17.63],
      [59.45, 17.0],
      KOPING
    ]
  },
  {
    id: 'malaren',
    modelId: 'cruiser',
    mode: 'Fritidsbåt',
    from: 'Köping',
    to: 'Slussen',
    instruction: 'Mälaren österut. Bara en sluss kvar. Gräla ändå.',
    startDay: 846,
    path: [KOPING, [59.45, 17.0], [59.36, 17.7], STOCKHOLM]
  }
];

// Invented, deliberately dull stops. None of them refer to a real place.
const SIGHTS: readonly Sight[] = [
  {
    id: 'buoy-eight',
    name: 'Boj nr 8, snarlik nr 7',
    modelId: 'buoy',
    position: [56.6, 20.6]
  },
  {
    id: 'replaced-stop',
    name: 'Hållplats för ersättningsbuss, ersatt',
    modelId: 'shelter',
    position: [48.4, 23.2]
  },
  {
    id: 'wrong-plug',
    name: 'Laddstolpe, fel kontakt',
    modelId: 'charger',
    position: [38.4, 33.0]
  },
  {
    id: 'unclear-queue',
    name: 'Kö, oklart till vad',
    modelId: 'queue',
    position: [27.6, 30.2]
  },
  {
    id: 'other-dune',
    name: 'Sanddyn, en annan',
    modelId: 'dune',
    position: [19.8, 30.4]
  },
  {
    id: 'horn-sign',
    name: 'Skylt: Hornet 300 mil',
    modelId: 'signpost',
    position: [13.4, 36.4]
  },
  {
    id: 'horn-office',
    name: 'Hornkontoret, lunchstängt',
    modelId: 'office',
    position: [7.4, 46.4]
  },
  {
    id: 'rest-stop-view',
    name: 'Rastplats med utsikt över förra rastplatsen',
    modelId: 'restStop',
    position: [-4.0, 33.6]
  },
  {
    id: 'no-exits',
    name: 'Rondell utan avfarter',
    modelId: 'roundabout',
    position: [-12.4, 31.4]
  },
  {
    id: 'roadwork-pending',
    name: 'Vägarbete, ej påbörjat',
    modelId: 'roadwork',
    position: [-23.4, 25.6]
  },
  {
    id: 'mower-garage',
    name: 'Parkeringshus för gräsklippare, fullt',
    modelId: 'garage',
    position: [-30.6, 21.4]
  },
  {
    id: 'wrong-way-wave',
    name: 'Våg åt fel håll',
    modelId: 'wave',
    position: [-40.5, -27.0]
  },
  {
    id: 'rounding-queue',
    name: 'Kö för rundning, nummerlapp 4 112',
    modelId: 'queue',
    position: [-58.2, -61.5]
  },
  {
    id: 'still-chile',
    name: 'Skylt: Fortfarande Chile',
    modelId: 'signpost',
    position: [-44.0, -79.5]
  },
  {
    id: 'summit-kiosk',
    name: 'Kiosk på krönet, obemannad',
    modelId: 'kiosk',
    position: [-30.6, -67.4]
  },
  {
    id: 'gate-again',
    name: 'Containerterminal, grind C igen',
    modelId: 'gate',
    position: [6.0, -25.0]
  },
  {
    id: 'nothing-three',
    name: 'Ingenting, del 3',
    modelId: 'buoy',
    position: [30.0, -21.0]
  }
];

export const JOURNEY_2: Journey = { legs: LEGS, sights: SIGHTS, arrivalDay: 847 };
