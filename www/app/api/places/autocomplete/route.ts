import { type NextRequest, NextResponse } from 'next/server';

import { autocompletePlaces, PlacesError } from '@/lib/places';

export const GET = async (request: NextRequest): Promise<NextResponse> => {
  const { searchParams } = request.nextUrl;
  const input = searchParams.get('input')?.trim() ?? '';
  const sessionToken = searchParams.get('sessionToken') ?? '';

  if (input.length < 2 || input.length > 200 || !/^[\w-]{1,36}$/.test(sessionToken)) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  try {
    return NextResponse.json({ suggestions: await autocompletePlaces(input, sessionToken) });
  } catch (error) {
    const status = error instanceof PlacesError ? error.status : 500;
    return NextResponse.json({ error: 'Autocomplete failed' }, { status });
  }
};
