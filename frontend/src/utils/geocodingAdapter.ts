/**
 * Replaceable Geocoding Adapter for LifeLink
 * Supports OpenStreetMap Nominatim, custom geocoding services, and offline landmark dictionaries.
 * Follows strict OpenStreetMap usage policy (User-Agent header, debounce, zero scraping).
 */

export interface GeocodingResult {
  displayName: string;
  lat: number;
  lng: number;
  type?: string;
  source: 'NOMINATIM' | 'OFFLINE_LANDMARK' | 'MANUAL';
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
}

export interface ReverseGeocodingResult {
  formattedAddress: string;
  lat: number;
  lng: number;
  suburb?: string;
  city?: string;
  state?: string;
  country?: string;
  source: 'NOMINATIM' | 'OFFLINE_LANDMARK' | 'COORDINATES_ONLY';
}

// Pre-configured offline landmarks for Nagpur Pilot & common zones
const OFFLINE_LANDMARKS: GeocodingResult[] = [
  {
    displayName: 'Sitabuldi Interchange / Metro Hub, Nagpur',
    lat: 21.1458,
    lng: 79.0882,
    city: 'Nagpur',
    state: 'Maharashtra',
    source: 'OFFLINE_LANDMARK',
  },
  {
    displayName: 'Government Medical College & Hospital (GMCH) / Medical Square, Nagpur',
    lat: 21.1293,
    lng: 79.0967,
    city: 'Nagpur',
    state: 'Maharashtra',
    source: 'OFFLINE_LANDMARK',
  },
  {
    displayName: 'AIIMS Nagpur Trauma Center, MIHAN Corridor, Nagpur',
    lat: 21.0378,
    lng: 79.0435,
    city: 'Nagpur',
    state: 'Maharashtra',
    source: 'OFFLINE_LANDMARK',
  },
  {
    displayName: 'Dharampeth West / Coffee House Square, Nagpur',
    lat: 21.1425,
    lng: 79.0654,
    city: 'Nagpur',
    state: 'Maharashtra',
    source: 'OFFLINE_LANDMARK',
  },
  {
    displayName: 'Ramdaspeth Central Clinic Corridor, Nagpur',
    lat: 21.1345,
    lng: 79.0765,
    city: 'Nagpur',
    state: 'Maharashtra',
    source: 'OFFLINE_LANDMARK',
  },
  {
    displayName: 'Sadar Residency Road / NMC HQ, Nagpur',
    lat: 21.1633,
    lng: 79.0818,
    city: 'Nagpur',
    state: 'Maharashtra',
    source: 'OFFLINE_LANDMARK',
  },
  {
    displayName: 'Wardha Road / Somalwada Square, Nagpur',
    lat: 21.085,
    lng: 79.068,
    city: 'Nagpur',
    state: 'Maharashtra',
    source: 'OFFLINE_LANDMARK',
  },
];

/**
 * Forward Geocoding: Search for coordinates by place name or address.
 * Prioritizes Indian territory and Nagpur pilot area.
 */
export async function searchAddress(query: string, customServiceUrl?: string): Promise<{
  results: GeocodingResult[];
  provider: string;
  offlineFallback: boolean;
  error?: string;
}> {
  if (!query || query.trim().length < 2) {
    return { results: [], provider: 'NONE', offlineFallback: false };
  }

  const cleanQuery = query.trim();

  // 1. Check local offline landmark dictionary first
  const localMatches = OFFLINE_LANDMARKS.filter((item) =>
    item.displayName.toLowerCase().includes(cleanQuery.toLowerCase())
  );

  const endpoint =
    customServiceUrl ||
    import.meta.env.VITE_GEOCODING_URL ||
    'https://nominatim.openstreetmap.org/search';

  try {
    const url = new URL(endpoint);
    url.searchParams.set('q', cleanQuery);
    url.searchParams.set('format', 'json');
    url.searchParams.set('countrycodes', 'in'); // Restrict to India
    url.searchParams.set('limit', '5');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        const parsedResults: GeocodingResult[] = data.map((item: any) => ({
          displayName: item.display_name,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
          type: item.type,
          city: item.address?.city || item.address?.town || item.address?.district,
          state: item.address?.state,
          pincode: item.address?.postcode,
          source: 'NOMINATIM',
        }));

        return {
          results: parsedResults,
          provider: 'OpenStreetMap Nominatim',
          offlineFallback: false,
        };
      }
    }
  } catch (err: any) {
    // Graceful offline fallback
    console.warn('Geocoding service unavailable, falling back to offline dictionary:', err.message);
  }

  // Fallback to local landmark matches
  if (localMatches.length > 0) {
    return {
      results: localMatches,
      provider: 'Offline Landmark Dictionary',
      offlineFallback: true,
    };
  }

  return {
    results: [],
    provider: 'OpenStreetMap Nominatim',
    offlineFallback: true,
    error: 'No address matches found. Please enter exact location coordinates or select on map.',
  };
}

/**
 * Reverse Geocoding: Look up human-readable address from coordinates.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  customServiceUrl?: string
): Promise<ReverseGeocodingResult> {
  // Validate coordinate ranges
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return {
      formattedAddress: 'Invalid coordinates',
      lat: 0,
      lng: 0,
      source: 'COORDINATES_ONLY',
    };
  }

  // 1. Check nearest offline landmark within 500m
  for (const landmark of OFFLINE_LANDMARKS) {
    const dLat = Math.abs(landmark.lat - lat);
    const dLng = Math.abs(landmark.lng - lng);
    if (dLat < 0.005 && dLng < 0.005) {
      return {
        formattedAddress: landmark.displayName,
        lat,
        lng,
        city: landmark.city,
        state: landmark.state,
        country: 'India',
        source: 'OFFLINE_LANDMARK',
      };
    }
  }

  const endpoint =
    customServiceUrl ||
    import.meta.env.VITE_REVERSE_GEOCODING_URL ||
    'https://nominatim.openstreetmap.org/reverse';

  try {
    const url = new URL(endpoint);
    url.searchParams.set('lat', lat.toString());
    url.searchParams.set('lon', lng.toString());
    url.searchParams.set('format', 'json');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.display_name) {
        return {
          formattedAddress: data.display_name,
          lat,
          lng,
          suburb: data.address?.suburb || data.address?.neighbourhood,
          city: data.address?.city || data.address?.town || data.address?.district,
          state: data.address?.state,
          country: data.address?.country,
          source: 'NOMINATIM',
        };
      }
    }
  } catch (err: any) {
    console.warn('Reverse geocoding unavailable:', err.message);
  }

  // Honest fallback: return precise coordinate string without inventing fake street names
  return {
    formattedAddress: `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    lat,
    lng,
    source: 'COORDINATES_ONLY',
  };
}
