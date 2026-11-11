import type { LatLon } from './geo';

export type VehicleId = 'cruiser' | 'scooter' | 'swimmer' | 'walker' | 'raft' | 'mower' | 'swan' | 'flamingo' | 'ship' | 'moonwalker' | 'bus';

export type SightModelId =
  'kiosk' | 'restStop' | 'charger' | 'roundabout' | 'dune' | 'office' | 'buoy' | 'wave' | 'garage' | 'signpost' | 'gate' | 'queue' | 'shelter' | 'roadwork';

export type Leg = {
  id: string;
  modelId: VehicleId;
  mode: string;
  from: string;
  to: string;
  instruction: string;
  startDay: number;
  path: readonly LatLon[];
};

export type Sight = {
  id: string;
  name: string;
  modelId: SightModelId;
  position: LatLon;
};

export const APP_TITLE = 'Pointless Travel Planner';
export const APP_TAGLINE = 'Den långa vägen hem';
export const ARRIVAL_DAY = 1160;

export const STOCKHOLM: LatLon = [59.32, 18.07];

const GOTHENBURG: LatLon = [57.71, 11.97];
const TARIFA: LatLon = [36.01, -5.6];
const TANGIER: LatLon = [35.77, -5.8];
const DAKAR: LatLon = [14.69, -17.44];
const MIAMI: LatLon = [25.76, -80.19];
const LOS_ANGELES: LatLon = [33.74, -118.27];
const HONOLULU: LatLon = [21.31, -157.86];
const MANILA: LatLon = [14.6, 120.98];
const PIRAEUS: LatLon = [37.94, 23.65];
const NYNASHAMN: LatLon = [58.9, 17.95];

export const LEGS: readonly Leg[] = [
  {
    id: 'gota-kanal',
    modelId: 'cruiser',
    mode: 'Fritidsbåt',
    from: 'Slussen',
    to: 'Göteborg',
    instruction: 'Göta kanal. Gräla i alla 64 slussar.',
    startDay: 1,
    path: [STOCKHOLM, [58.6, 17.0], [58.48, 16.4], [58.54, 14.8], [58.7, 13.6], [58.3, 12.4], GOTHENBURG]
  },
  {
    id: 'europe',
    modelId: 'scooter',
    mode: 'Elsparkcykel',
    from: 'Göteborg',
    to: 'Tarifa',
    instruction: 'Ladda fyra timmar var tredje mil.',
    startDay: 15,
    path: [GOTHENBURG, [55.7, 12.5], [53.55, 10.0], [50.9, 6.9], [48.85, 2.35], [44.84, -0.58], [40.42, -3.7], TARIFA]
  },
  {
    id: 'gibraltar',
    modelId: 'swimmer',
    mode: 'Simtur',
    from: 'Tarifa',
    to: 'Tanger',
    instruction: 'Korsa Gibraltarsundet. Håll vänster.',
    startDay: 42,
    path: [TARIFA, TANGIER]
  },
  {
    id: 'sahara',
    modelId: 'walker',
    mode: 'Promenad',
    from: 'Tanger',
    to: 'Dakar',
    instruction: 'Gå österut genom Sahara. Ja, österut.',
    startDay: 42,
    path: [TANGIER, [34.68, -1.9], [32.5, 3.7], [22.8, 5.5], [16.97, 7.99], [13.5, 2.1], [12.37, -1.52], [12.64, -8.0], [13.77, -13.67], DAKAR]
  },
  {
    id: 'atlantic',
    modelId: 'raft',
    mode: 'Flotte',
    from: 'Dakar',
    to: 'Miami',
    instruction: 'Driv med strömmen. Styr inte.',
    startDay: 224,
    path: [DAKAR, [13.1, -59.6], [20.0, -73.0], [24.5, -77.5], MIAMI]
  },
  {
    id: 'usa',
    modelId: 'mower',
    mode: 'Åkgräsklippare',
    from: 'Miami',
    to: 'Los Angeles',
    instruction: 'Följ I-10 västerut i 8 km/h.',
    startDay: 500,
    path: [MIAMI, [30.19, -82.64], [29.95, -90.07], [29.76, -95.37], [29.42, -98.49], [31.76, -106.49], [32.22, -110.97], [33.45, -112.07], LOS_ANGELES]
  },
  {
    id: 'pacific-east',
    modelId: 'swan',
    mode: 'Svantrampbåt',
    from: 'Los Angeles',
    to: 'Honolulu',
    instruction: 'Trampa till Honolulu.',
    startDay: 569,
    path: [LOS_ANGELES, HONOLULU]
  },
  {
    id: 'pacific-west',
    modelId: 'flamingo',
    mode: 'Badflamingo',
    from: 'Honolulu',
    to: 'Manila',
    instruction: 'Flyt vidare. Det går inte fortare.',
    startDay: 672,
    path: [HONOLULU, MANILA]
  },
  {
    id: 'suez',
    modelId: 'ship',
    mode: 'Containerfartyg',
    from: 'Manila',
    to: 'Pireus',
    instruction: 'Lifta. Fastna i Suezkanalen.',
    startDay: 1001,
    path: [
      MANILA,
      [1.29, 103.85],
      [2.5, 101.5],
      [5.5, 98.0],
      [6.0, 95.0],
      [5.92, 80.59],
      [13.5, 52.0],
      [12.2, 45.0],
      [12.6, 43.4],
      [20.0, 38.8],
      [27.5, 34.0],
      [29.97, 32.55],
      [31.26, 32.3],
      PIRAEUS
    ]
  },
  {
    id: 'balkan',
    modelId: 'moonwalker',
    mode: 'Moonwalk',
    from: 'Pireus',
    to: 'Nynäshamn',
    instruction: 'Backa norrut genom Europa.',
    startDay: 1027,
    path: [PIRAEUS, [40.64, 22.94], [42.0, 21.43], [44.8, 20.47], [47.5, 19.04], [50.06, 19.94], [54.35, 18.65], NYNASHAMN]
  },
  {
    id: 'replacement-bus',
    modelId: 'bus',
    mode: 'Ersättningsbuss 43X',
    from: 'Nynäshamn',
    to: 'Slussen',
    instruction: 'Sista biten. Kliv av vid Slussen.',
    startDay: 1159,
    path: [NYNASHAMN, STOCKHOLM]
  }
];

// Invented, deliberately dull stops. None of them refer to a real place.
export const SIGHTS: readonly Sight[] = [
  {
    id: 'kiosk',
    name: 'Slusskiosk, stängd för säsongen',
    modelId: 'kiosk',
    position: [56.9, 14.6]
  },
  {
    id: 'rest-stop',
    name: 'Rastplats utan utsikt',
    modelId: 'restStop',
    position: [51.6, 11.2]
  },
  {
    id: 'charger',
    name: 'Laddstolpe, upptagen',
    modelId: 'charger',
    position: [46.4, 3.4]
  },
  {
    id: 'roundabout',
    name: 'Rondell med okänd konst',
    modelId: 'roundabout',
    position: [39.2, -1.4]
  },
  {
    id: 'dune',
    name: 'Sanddyn, en av flera',
    modelId: 'dune',
    position: [27.0, 1.2]
  },
  {
    id: 'office',
    name: 'Stängt turistkontor',
    modelId: 'office',
    position: [18.4, 3.2]
  },
  {
    id: 'buoy',
    name: 'Boj nr 7',
    modelId: 'buoy',
    position: [17.8, -34.0]
  },
  {
    id: 'wave',
    name: 'Samma våg som i går',
    modelId: 'wave',
    position: [9.5, -50.0]
  },
  {
    id: 'garage',
    name: 'Parkeringshus, plan 3',
    modelId: 'garage',
    position: [33.6, -93.0]
  },
  {
    id: 'signpost',
    name: 'Skylt om nästa skylt',
    modelId: 'signpost',
    position: [36.0, -108.5]
  },
  {
    id: 'nothing-one',
    name: 'Ingenting, del 1',
    modelId: 'buoy',
    position: [31.5, -139.0]
  },
  {
    id: 'date-line',
    name: 'Datumgränsen (syns ej)',
    modelId: 'signpost',
    position: [23.5, 180.0]
  },
  {
    id: 'nothing-two',
    name: 'Ingenting, del 2',
    modelId: 'wave',
    position: [14.5, 147.0]
  },
  {
    id: 'gate',
    name: 'Containerterminal, grind C',
    modelId: 'gate',
    position: [5.2, 102.2]
  },
  {
    id: 'queue',
    name: 'Väntkö till Suezkanalen',
    modelId: 'queue',
    position: [22.5, 36.6]
  },
  {
    id: 'shelter',
    name: 'Busskur utan tidtabell',
    modelId: 'shelter',
    position: [45.6, 23.6]
  },
  {
    id: 'roadwork',
    name: 'Vägarbete, pågår sedan länge',
    modelId: 'roadwork',
    position: [51.8, 22.4]
  }
];
