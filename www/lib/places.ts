export type PlaceSuggestion = {
  placeId: string;
  text: string;
};

export type Place = {
  placeId: string;
  address: string;
  latitude: number;
  longitude: number;
};

type AddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

type AutocompleteResponse = {
  suggestions?: {
    placePrediction?: { placeId: string; text: { text: string } };
  }[];
};

type PlaceDetailsResponse = {
  id: string;
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  addressComponents?: AddressComponent[];
};

const PLACES_URL = 'https://places.googleapis.com/v1';

// Bounding box around the allowed postal towns, exact check is done on select.
const STOCKHOLM_BOUNDS = {
  low: { latitude: 59.18, longitude: 17.76 },
  high: { latitude: 59.44, longitude: 18.45 }
};

// Google has no municipality component for Sweden, so match on postal towns.
const STOCKHOLM_POSTAL_TOWNS = new Set([
  'Bagarmossen',
  'Bandhagen',
  'Bromma',
  'Enskede',
  'Enskede Gård',
  'Enskededalen',
  'Farsta',
  'Hägersten',
  'Hässelby',
  'Johanneshov',
  'Kista',
  'Skarpnäck',
  'Skärholmen',
  'Sköndal',
  'Spånga',
  'Stockholm',
  'Stockholm-Globen',
  'Tyresö',
  'Vällingby',
  'Älvsjö',
  'Årsta'
]);

export class PlacesError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

const getApiKey = (): string => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new PlacesError('GOOGLE_MAPS_API_KEY is not set', 500);
  }
  return key;
};

const placesFetch = async <T>(path: string, fieldMask: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${PLACES_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': getApiKey(),
      'X-Goog-FieldMask': fieldMask
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  if (!response.ok) {
    console.error('Places API error', response.status, await response.text());
    throw new PlacesError('Places API request failed', 502);
  }
  return (await response.json()) as T;
};

export const autocompletePlaces = async (input: string, sessionToken: string): Promise<PlaceSuggestion[]> => {
  const data = await placesFetch<AutocompleteResponse>('/places:autocomplete', 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text', {
    input,
    sessionToken,
    languageCode: 'sv',
    includedRegionCodes: ['se'],
    locationRestriction: { rectangle: STOCKHOLM_BOUNDS }
  });
  return (data.suggestions ?? []).flatMap(({ placePrediction }) => (placePrediction ? [{ placeId: placePrediction.placeId, text: placePrediction.text.text }] : []));
};

const findComponent = (components: AddressComponent[], type: string): string | undefined => components.find(({ types }) => types?.includes(type))?.longText;

const isInStockholm = (components: AddressComponent[]): boolean => {
  const postalTown = findComponent(components, 'postal_town');
  if (postalTown) {
    return STOCKHOLM_POSTAL_TOWNS.has(postalTown);
  }
  // Areas and landmarks lack a postal town but have the city as locality.
  return findComponent(components, 'locality') === 'Stockholm';
};

export const getStockholmPlace = async (placeId: string, sessionToken: string): Promise<Place> => {
  const query = new URLSearchParams({ languageCode: 'sv', sessionToken });
  const data = await placesFetch<PlaceDetailsResponse>(`/places/${encodeURIComponent(placeId)}?${query}`, 'id,formattedAddress,location,addressComponents');
  if (!data.location || !isInStockholm(data.addressComponents ?? [])) {
    throw new PlacesError('Place is not in Stockholm', 422);
  }
  return {
    placeId: data.id,
    address: data.formattedAddress ?? '',
    latitude: data.location.latitude,
    longitude: data.location.longitude
  };
};
