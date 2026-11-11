import { type NextRequest, NextResponse } from 'next/server';

import { parseStockholmCoordinates } from '@/lib/validation';

const STREET_VIEW_URL = 'https://maps.googleapis.com/maps/api/streetview';

export const GET = async (request: NextRequest): Promise<Response> => {
  const { searchParams } = request.nextUrl;
  const location = parseStockholmCoordinates(searchParams.get('lat'), searchParams.get('lng'));
  const heading = Number(searchParams.get('heading'));
  const key = process.env.GOOGLE_MAPS_API_KEY;

  if (!location || !Number.isFinite(heading) || heading < 0 || heading > 360) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({ error: 'Street view is not configured' }, { status: 500 });
  }

  const query = new URLSearchParams({
    size: '640x400',
    location: `${location.latitude},${location.longitude}`,
    heading: String(Math.round(heading)),
    pitch: '0',
    fov: '90',
    radius: '100',
    source: 'outdoor',
    return_error_code: 'true',
    key
  });
  const response = await fetch(`${STREET_VIEW_URL}?${query}`, { cache: 'no-store' });
  if (!response.ok) {
    const status = response.status === 404 ? 404 : 502;
    return NextResponse.json({ error: 'No street view image' }, { status });
  }

  return new Response(response.body, {
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400'
    }
  });
};
