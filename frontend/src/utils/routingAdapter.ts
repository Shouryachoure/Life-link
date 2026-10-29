/**
 * Replaceable Routing Adapter for LifeLink
 * Supports Mapbox Directions v5, OpenStreetMap OSRM, and zero-cost Haversine fallback.
 * Strictly adheres to rule: Never manufacture road routes or fake ETAs.
 */

export interface RouteResult {
  coordinates: [number, number][]; // [lat, lng][]
  distanceKm: string;
  durationMins: number | null; // null if road routing is unavailable
  provider: string;
  isRoadRouting: boolean;
  isStraightLine: boolean;
  nextInstruction?: string;
  summary?: string;
  disclaimer?: string;
}

// Haversine formula for exact straight-line geographic distance
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

export async function fetchDirections(
  start: [number, number],
  end: [number, number],
  mapboxToken?: string,
  profile: string = 'mapbox/driving'
): Promise<RouteResult> {
  const [startLat, startLng] = start;
  const [endLat, endLng] = end;
  const coordinates = `${startLng},${startLat};${endLng},${endLat}`;

  // 1. Try Mapbox Directions API if token is provided
  if (mapboxToken && mapboxToken.trim().length > 0) {
    try {
      const mapboxUrl = `https://api.mapbox.com/directions/v5/${profile}/${coordinates}?geometries=geojson&overview=full&steps=true&access_token=${mapboxToken.trim()}`;
      const response = await fetch(mapboxUrl);

      if (response.ok) {
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const rawCoords = route.geometry.coordinates;
          const latLngs: [number, number][] = rawCoords.map((c: [number, number]) => [c[1], c[0]]);

          const distKm = (route.distance / 1000).toFixed(1);
          const durMins = Math.max(1, Math.round(route.duration / 60));
          const firstStep = route.legs?.[0]?.steps?.[0];

          return {
            coordinates: latLngs,
            distanceKm: distKm,
            durationMins: durMins,
            provider: 'Mapbox Directions v5',
            isRoadRouting: true,
            isStraightLine: false,
            nextInstruction: firstStep?.maneuver?.instruction || undefined,
            summary: route.legs?.[0]?.summary || undefined,
          };
        }
      }
    } catch (err) {
      // Continue to open-source OSRM
    }
  }

  // 2. Try OpenStreetMap OSRM Public Routing Engine
  try {
    const osrmBase =
      import.meta.env.VITE_OSRM_ROUTING_URL || 'https://router.project-osrm.org/route/v1/driving';
    const osrmUrl = `${osrmBase.replace(/\/$/, '')}/${coordinates}?geometries=geojson&overview=full&steps=true`;
    const response = await fetch(osrmUrl);

    if (response.ok) {
      const data = await response.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const rawCoords = route.geometry.coordinates;
        const latLngs: [number, number][] = rawCoords.map((c: [number, number]) => [c[1], c[0]]);

        const distKm = (route.distance / 1000).toFixed(1);
        const durMins = Math.max(1, Math.round(route.duration / 60));

        return {
          coordinates: latLngs,
          distanceKm: distKm,
          durationMins: durMins,
          provider: 'OSRM Road Routing',
          isRoadRouting: true,
          isStraightLine: false,
          summary: route.legs?.[0]?.summary || undefined,
        };
      }
    }
  } catch (err) {
    // Fallback to straight-line
  }

  // 3. Honest Straight-Line Distance Fallback
  // Never fabricate simulated road curves or fake traffic ETAs when routing services are down.
  const directDistance = calculateHaversineDistanceKm(startLat, startLng, endLat, endLng);

  return {
    coordinates: [
      [startLat, startLng],
      [endLat, endLng],
    ],
    distanceKm: directDistance.toFixed(1),
    durationMins: null, // Explicitly null: cannot know road duration without routing
    provider: 'Straight-Line Distance (Road Routing Offline)',
    isRoadRouting: false,
    isStraightLine: true,
    disclaimer:
      'Road routing is currently unavailable. Displaying direct geographic distance. Actual driving distance and ETA may vary.',
  };
}
