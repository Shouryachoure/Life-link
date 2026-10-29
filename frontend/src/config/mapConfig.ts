/**
 * Centralized Map and Geospatial Configuration for LifeLink
 * Supports configurable tile providers, routing endpoints, and geocoding services.
 * Defaults to ₹0 open-source OpenStreetMap / CARTO tiles centered on Nagpur Pilot Zone.
 */

export interface MapTileProvider {
  id: string;
  name: string;
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains?: string[];
}

export const MAP_CONFIG = {
  // Initial Pilot Center: Sitabuldi, Nagpur, Maharashtra, India
  defaultCenter: [21.1458, 79.0882] as [number, number],
  defaultZoom: 13,
  minZoom: 4,
  maxZoom: 19,

  // Pan boundary limits for India (approximate bounding box)
  indiaBounds: {
    southWest: [6.5, 68.0] as [number, number],
    northEast: [37.5, 97.5] as [number, number],
  },

  // Map Tile Providers (₹0 Zero-Cost Standard OpenStreetMap compliant)
  tileProviders: {
    osmStandard: {
      id: 'osm-standard',
      name: 'OpenStreetMap Standard',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19,
    },
  } as Record<string, MapTileProvider>,

  // Default active provider
  defaultTileProvider: 'osmStandard',

  // Stale Telemetry Thresholds
  staleGpsThresholdMinutes: 30,
  movementSpeedThresholdKmH: 3.0,

  // Routing Endpoint
  osrmEndpoint:
    import.meta.env.VITE_OSRM_ROUTING_URL || 'https://router.project-osrm.org/route/v1/driving',

  // Pre-configured Pilot Landmarks for Manual Location Selection (Fallback when GPS is denied)
  nagpurLandmarks: [
    { name: 'Sitabuldi Interchange', lat: 21.1458, lng: 79.0882, area: 'Central Nagpur' },
    { name: 'GMCH / Medical Square', lat: 21.1293, lng: 79.0967, area: 'South Nagpur' },
    { name: 'AIIMS Nagpur / MIHAN Trauma Corridor', lat: 21.0378, lng: 79.0435, area: 'MIHAN SEZ' },
    { name: 'Dharampeth West', lat: 21.1425, lng: 79.0654, area: 'West Nagpur' },
    { name: 'Ramdaspeth Clinic Hub', lat: 21.1345, lng: 79.0765, area: 'Central-South Nagpur' },
    { name: 'Sadar Residency Road', lat: 21.1633, lng: 79.0818, area: 'North Nagpur' },
    { name: 'Wardha Road Corridor', lat: 21.085, lng: 79.068, area: 'South Transit Route' },
  ],
};
