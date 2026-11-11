import { type NextRequest, NextResponse } from 'next/server';

import { PlacesError } from '@/lib/places';
import { getStreetLegs } from '@/lib/streetRoute';
import { parseStockholmCoordinates } from '@/lib/validation';

export const GET = async (request: NextRequest): Promise<NextResponse> => {
  const { searchParams } = request.nextUrl;
  const origin = parseStockholmCoordinates(searchParams.get('originLat'), searchParams.get('originLng'));
  const destination = parseStockholmCoordinates(searchParams.get('destinationLat'), searchParams.get('destinationLng'));

  if (!origin || !destination) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  try {
    return NextResponse.json(await getStreetLegs(origin, destination));
  } catch (error) {
    const status = error instanceof PlacesError ? error.status : 500;
    return NextResponse.json({ error: 'Trip lookup failed' }, { status });
  }
};
