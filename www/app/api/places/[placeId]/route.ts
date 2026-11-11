import { type NextRequest, NextResponse } from 'next/server';

import { getStockholmPlace, PlacesError } from '@/lib/places';

export const GET = async (request: NextRequest, { params }: { params: Promise<{ placeId: string }> }): Promise<NextResponse> => {
  const { placeId } = await params;
  const sessionToken = request.nextUrl.searchParams.get('sessionToken') ?? '';

  if (!/^[\w-]{1,300}$/.test(placeId) || !/^[\w-]{1,36}$/.test(sessionToken)) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  try {
    return NextResponse.json({ place: await getStockholmPlace(placeId, sessionToken) });
  } catch (error) {
    const status = error instanceof PlacesError ? error.status : 500;
    const message = status === 422 ? 'Place is not in Stockholm' : 'Place lookup failed';
    return NextResponse.json({ error: message }, { status });
  }
};
