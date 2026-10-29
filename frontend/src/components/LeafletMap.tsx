import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Navigation, Compass, AlertTriangle, LocateFixed, ExternalLink } from 'lucide-react';
import { MAP_CONFIG } from '../config/mapConfig';
import { fetchDirections, type RouteResult } from '../utils/routingAdapter';

export interface HospitalMarkerItem {
  id: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  distanceKm?: number | null;
  distanceLabel?: string;
  totalBeds?: number;
  availableBeds?: number;
  contactNumber?: string;
  isLifeLinkPartner?: boolean;
  facilityType?: string;
  verificationStatus?: string;
}

export interface AmbulanceMarkerItem {
  id: string;
  vehicleNumber: string;
  ambulanceType?: string;
  lat?: number;
  lng?: number;
  currentLat?: number;
  currentLng?: number;
  operationalStatus?: string;
  ownership?: 'HOSPITAL_OWNED' | 'PRIVATE_OPERATOR' | string;
  ownerName?: string;
  movementStatus?: string;
  speedKmH?: number;
  distanceFromPatientKm?: number | null;
  distanceFromHospitalKm?: number | null;
  isDemo?: boolean;
  dataFreshness?: 'LIVE' | 'STALE' | 'UNAVAILABLE' | 'SIMULATED';
  isEligibleForDispatch?: boolean;
}

export interface AmbulanceProviderMarkerItem {
  id: string;
  name: string;
  operatorType?: string;
  operatorTypeLabel?: string;
  contactNumber: string;
  alternateNumber?: string | null;
  address?: string;
  locality?: string;
  tehsil?: string;
  lat: number;
  lng: number;
  distanceKm?: number | null;
  distanceLabel?: string;
  advertisedServiceTypes?: string[];
  advertisedIcuOrVentilatorCapability?: boolean;
  dataConfidence?: string;
  isHelpline?: boolean;
  isHospitalAffiliated?: boolean;
  linkedHospitalName?: string;
  coverageGroup?: string;
}

interface LeafletMapProps {
  center?: [number, number];
  patientLoc?: [number, number] | null;
  driverLoc?: [number, number] | null;
  hospitalLoc?: [number, number] | null;
  status?: string;
  zoom?: number;
  nearbyDrivers?: { currentLat: number; currentLng: number; vehicleNumber: string; driver?: { name: string } }[];
  hospitals?: HospitalMarkerItem[];
  ambulances?: AmbulanceMarkerItem[];
  ambulanceProviders?: AmbulanceProviderMarkerItem[];
  selectedHospitalId?: string;
  selectedAmbulanceProviderId?: string;
  onSelectHospital?: (hospitalId: string) => void;
  onSelectAmbulanceProvider?: (providerId: string) => void;
  onMapClick?: (coords: { lat: number; lng: number }) => void;
  onRouteCalculated?: (route: RouteResult | null) => void;
  mapboxToken?: string;
  profile?: 'mapbox/driving' | 'mapbox/driving-traffic' | 'mapbox/walking' | 'mapbox/cycling';
  className?: string;
  showLayerControls?: boolean;
}

function isValidCoord(lat?: number | null, lng?: number | null): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    (lat !== 0 || lng !== 0)
  );
}

// 1. Refined Patient / User Location DivIcon
const createPatientIcon = () =>
  L.divIcon({
    className: 'custom-patient-pin',
    html: `
      <div style="position: relative; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;">
        <div style="position: absolute; width: 30px; height: 30px; border-radius: 50%; background: rgba(239, 68, 68, 0.35); animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
        <div style="position: relative; width: 22px; height: 22px; border-radius: 50%; background: #ef4444; border: 2.5px solid #ffffff; box-shadow: 0 2px 8px rgba(239,68,68,0.6); display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; font-weight: bold;">
          ●
        </div>
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });

// 2. Refined Hospital DivIcon (Sleek Teardrop Pin, Cross Vector, Partner vs Directory Colors)
const createHospitalIcon = (isSelected?: boolean, isPartner: boolean = true) => {
  const pinColor = isPartner ? '#059669' : '#2563eb';
  const ringColor = isSelected ? '#f59e0b' : '#ffffff';
  const size = isSelected ? 36 : 28;
  const height = isSelected ? 44 : 36;
  const zIndex = isSelected ? 1000 : 1;

  return L.divIcon({
    className: `custom-hospital-pin ${isSelected ? 'is-selected' : ''}`,
    html: `
      <div style="position: relative; width: ${size}px; height: ${height}px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; cursor: pointer; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.35)); z-index: ${zIndex};">
        ${isSelected ? `<div style="position: absolute; top: -4px; width: ${size + 8}px; height: ${size + 8}px; border-radius: 50%; background: rgba(245, 158, 11, 0.35); animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>` : ''}
        <div style="width: ${size}px; height: ${size}px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); background: ${pinColor}; border: 2px solid ${ringColor}; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 5px rgba(0,0,0,0.25);">
          <div style="transform: rotate(45deg); color: #ffffff; font-weight: 900; font-size: ${isSelected ? '14px' : '11px'}; line-height: 1; display: flex; align-items: center; justify-content: center;">
            ✚
          </div>
        </div>
      </div>
    `,
    iconSize: [size, height],
    iconAnchor: [size / 2, height],
    popupAnchor: [0, -height],
  });
};

// 3. Ambulance Provider Dispatch Station Pin (Distinct Violet/Purple Teardrop Pin)
const createAmbulanceProviderIcon = (isSelected?: boolean, isHelpline?: boolean) => {
  const pinColor = isHelpline ? '#dc2626' : '#7c3aed';
  const ringColor = isSelected ? '#f59e0b' : '#ffffff';
  const size = isSelected ? 36 : 28;
  const height = isSelected ? 44 : 36;
  const zIndex = isSelected ? 1000 : 2;

  return L.divIcon({
    className: `custom-amb-provider-pin ${isSelected ? 'is-selected' : ''}`,
    html: `
      <div style="position: relative; width: ${size}px; height: ${height}px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; cursor: pointer; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.35)); z-index: ${zIndex};">
        ${isSelected ? `<div style="position: absolute; top: -4px; width: ${size + 8}px; height: ${size + 8}px; border-radius: 50%; background: rgba(245, 158, 11, 0.4); animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>` : ''}
        <div style="width: ${size}px; height: ${size}px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); background: ${pinColor}; border: 2px solid ${ringColor}; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 5px rgba(0,0,0,0.25);">
          <div style="transform: rotate(45deg); color: #ffffff; font-size: ${isSelected ? '15px' : '12px'}; line-height: 1; display: flex; align-items: center; justify-content: center;">
            🚑
          </div>
        </div>
      </div>
    `,
    iconSize: [size, height],
    iconAnchor: [size / 2, height],
    popupAnchor: [0, -height],
  });
};

// 4. Refined Moving Ambulance Rig Marker Icon (Only for active live driver app sessions)
const createAmbulanceMarkerIcon = (amb: AmbulanceMarkerItem) => {
  const isAvailable = amb.operationalStatus === 'AVAILABLE';
  const badgeBg = isAvailable ? '#059669' : '#d97706';
  const isOffline = amb.dataFreshness === 'UNAVAILABLE';
  const opacity = isOffline ? '0.6' : '1.0';

  return L.divIcon({
    className: 'custom-amb-pin',
    html: `
      <div style="position: relative; width: 28px; height: 34px; display: flex; flex-direction: column; align-items: center; opacity: ${opacity}; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.3));">
        <div style="width: 28px; height: 28px; border-radius: 8px; background: ${badgeBg}; border: 2px solid #ffffff; display: flex; align-items: center; justify-content: center; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
          🚑
        </div>
        <div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 5px solid ${badgeBg}; margin-top: -1px;"></div>
      </div>
    `,
    iconSize: [28, 34],
    iconAnchor: [14, 34],
    popupAnchor: [0, -34],
  });
};

export const LeafletMap: React.FC<LeafletMapProps> = ({
  center,
  patientLoc,
  driverLoc,
  hospitalLoc,
  status,
  zoom = 13,
  nearbyDrivers = [],
  hospitals = [],
  ambulances = [],
  ambulanceProviders = [],
  selectedHospitalId,
  selectedAmbulanceProviderId,
  onSelectHospital,
  onSelectAmbulanceProvider,
  onMapClick,
  onRouteCalculated,
  mapboxToken,
  profile = 'mapbox/driving',
  className = '',
  showLayerControls = true,
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.Layer[]>([]);
  const polylineLayersRef = useRef<L.Polyline[]>([]);
  const hospitalMarkersMapRef = useRef<Map<string, L.Marker>>(new Map());
  const ambulanceProviderMarkersMapRef = useRef<Map<string, L.Marker>>(new Map());

  const [routeStats, setRouteStats] = useState<RouteResult | null>(null);
  const [tileError, setTileError] = useState(false);
  const [showHospitalsLayer, setShowHospitalsLayer] = useState(true);
  const [showAmbulanceProvidersLayer, setShowAmbulanceProvidersLayer] = useState(true);

  const activeToken = mapboxToken || import.meta.env.VITE_MAPBOX_TOKEN || '';

  // 1. Initialize Leaflet Map with OpenStreetMap Standard as the single default tile layer
  useEffect(() => {
    if (!mapRef.current) return;

    const initialCenter: [number, number] =
      isValidCoord(patientLoc?.[0], patientLoc?.[1])
        ? [patientLoc![0], patientLoc![1]]
        : center && isValidCoord(center[0], center[1])
        ? [center[0], center[1]]
        : MAP_CONFIG.defaultCenter;

    const map = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: true,
      minZoom: 3,
      maxZoom: 19,
    }).setView(initialCenter, zoom);

    mapInstanceRef.current = map;

    // Attach OpenStreetMap Standard Tile Layer
    const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      minZoom: 3,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      crossOrigin: true,
    }).addTo(map);

    tileLayer.on('tileerror', () => {
      setTileError(true);
    });

    tileLayer.on('load', () => {
      setTileError(false);
    });

    tileLayerRef.current = tileLayer;

    // Recalculate dimensions on container resize & tab visibility changes
    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });
    resizeObserver.observe(mapRef.current);

    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (onMapClick) {
        onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });

    return () => {
      clearTimeout(timer);
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  // 2. Recenter helper
  const handleRecenter = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const target =
      isValidCoord(patientLoc?.[0], patientLoc?.[1])
        ? patientLoc!
        : center && isValidCoord(center[0], center[1])
        ? center
        : MAP_CONFIG.defaultCenter;

    map.flyTo([target[0], target[1]], zoom, { animate: true, duration: 0.8 });
  };

  // 3. Two-Way Selection Sync: Focus marker when selectedHospitalId or selectedAmbulanceProviderId changes externally
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (selectedHospitalId) {
      const targetMarker = hospitalMarkersMapRef.current.get(selectedHospitalId);
      if (targetMarker) {
        targetMarker.openPopup();
        const latLng = targetMarker.getLatLng();
        if (isValidCoord(latLng.lat, latLng.lng)) {
          map.flyTo([latLng.lat, latLng.lng], 16, {
            animate: true,
            duration: 1.0,
          });
        }
      }
    } else if (selectedAmbulanceProviderId) {
      const targetMarker = ambulanceProviderMarkersMapRef.current.get(selectedAmbulanceProviderId);
      if (targetMarker) {
        targetMarker.openPopup();
        const latLng = targetMarker.getLatLng();
        if (isValidCoord(latLng.lat, latLng.lng)) {
          map.flyTo([latLng.lat, latLng.lng], 16, {
            animate: true,
            duration: 1.0,
          });
        }
      }
    }
  }, [selectedHospitalId, selectedAmbulanceProviderId]);

  // 4. Update markers & direction route
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear old markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    hospitalMarkersMapRef.current.clear();
    ambulanceProviderMarkersMapRef.current.clear();

    // Clear old polylines
    polylineLayersRef.current.forEach((layer) => layer.remove());
    polylineLayersRef.current = [];

    const boundsPoints: L.LatLngExpression[] = [];

    // Patient Marker
    if (isValidCoord(patientLoc?.[0], patientLoc?.[1])) {
      const patientMarker = L.marker([patientLoc![0], patientLoc![1]], {
        icon: createPatientIcon(),
      })
        .addTo(map)
        .bindPopup('<b>Patient Location</b><br/><span style="font-size:11px;color:#64748b;">Verified GPS coordinates</span>');

      markersRef.current.push(patientMarker);
      boundsPoints.push([patientLoc![0], patientLoc![1]]);
    }

    // Receiving Hospital Marker
    if (isValidCoord(hospitalLoc?.[0], hospitalLoc?.[1])) {
      const hospitalMarker = L.marker([hospitalLoc![0], hospitalLoc![1]], {
        icon: createHospitalIcon(true, true),
      })
        .addTo(map)
        .bindPopup('<b>Designated Receiving ER</b><br/><span style="font-size:11px;color:#059669;">Emergency Care Unit</span>');

      markersRef.current.push(hospitalMarker);
      boundsPoints.push([hospitalLoc![0], hospitalLoc![1]]);
    }

    const validHospitals = hospitals.filter((h) => isValidCoord(h.lat, h.lng));

    // Hospital List Markers with Coordinate Spiderfying for Shared Campuses
    if (showHospitalsLayer) {

    // Group hospitals that share identical or near-identical coordinates (< 0.0003 deg, ~30 meters)
    const coordGroups: { centerLat: number; centerLng: number; items: HospitalMarkerItem[] }[] = [];

    validHospitals.forEach((h) => {
      let group = coordGroups.find(
        (g) => Math.abs(g.centerLat - h.lat) < 0.0003 && Math.abs(g.centerLng - h.lng) < 0.0003
      );
      if (!group) {
        group = { centerLat: h.lat, centerLng: h.lng, items: [] };
        coordGroups.push(group);
      }
      group.items.push(h);
    });

    coordGroups.forEach((group) => {
      const isMulti = group.items.length > 1;
      const spiderRadius = 0.00028; // ~28 meters offset

      group.items.forEach((h, idx) => {
        // Spiderfy offset if multiple facilities share campus
        let mLat = h.lat;
        let mLng = h.lng;
        if (isMulti) {
          const angle = (2 * Math.PI * idx) / group.items.length;
          mLat = group.centerLat + spiderRadius * Math.cos(angle);
          mLng = group.centerLng + spiderRadius * Math.sin(angle);
        }

        const isSelected = selectedHospitalId === h.id;
        const isPartner = h.isLifeLinkPartner !== false;

        const marker = L.marker([mLat, mLng], {
          icon: createHospitalIcon(isSelected, isPartner),
          zIndexOffset: isSelected ? 1000 : 0,
        }).addTo(map);

        // Tooltip on hover
        marker.bindTooltip(h.name, {
          direction: 'top',
          offset: [0, -32],
          className: 'll-map-tooltip',
        });

        // Popup on click
        const partnerBadge = isPartner
          ? '<div style="font-size:10px;font-weight:bold;color:#059669;margin-bottom:3px;">✓ LifeLink Verified Partner (Live Beds)</div>'
          : '<div style="font-size:10px;font-weight:bold;color:#2563eb;margin-bottom:3px;">ℹ Public Hospital Directory Listing</div>';

        const campusNotice = isMulti
          ? `<div style="font-size:9.5px;color:#d97706;font-weight:600;margin-bottom:4px;">Shared Medical Complex (${idx + 1} of ${group.items.length} facilities)</div>`
          : '';

        const bedsText =
          isPartner && h.availableBeds !== undefined
            ? `<div style="color:#059669;font-size:11px;font-weight:bold;margin-top:3px;">Available Beds: ${h.availableBeds} / ${h.totalBeds || 0}</div>`
            : '';
        const phoneText = h.contactNumber
          ? `<div style="margin-top:5px;"><a href="tel:${h.contactNumber}" style="display:inline-block;color:#2563eb;font-size:11px;font-weight:bold;text-decoration:none;background:#eff6ff;padding:3px 7px;border-radius:6px;">📞 Call Facility: ${h.contactNumber}</a></div>`
          : '';
        const distText = h.distanceLabel
          ? `<div style="color:#64748b;font-size:11px;margin-top:2px;">${h.distanceLabel}</div>`
          : '';
        const addressText = h.address
          ? `<div style="color:#94a3b8;font-size:10px;margin-top:3px;line-height:1.3;">${h.address}</div>`
          : '';

        marker.bindPopup(`
          <div style="font-family:system-ui,-apple-system,sans-serif; min-width: 190px; max-width: 250px; padding: 2px;">
            ${partnerBadge}
            ${campusNotice}
            <h4 style="font-weight:bold;margin:0 0 3px;font-size:13px;color:#0f172a;line-height:1.3;">${h.name}</h4>
            ${distText}
            ${bedsText}
            ${phoneText}
            ${addressText}
          </div>
        `);

        marker.on('click', () => {
          if (isValidCoord(mLat, mLng)) {
            map.flyTo([mLat, mLng], 16, { animate: true, duration: 1.0 });
          }
          if (onSelectHospital) {
            onSelectHospital(h.id);
          }
        });

        markersRef.current.push(marker);
        hospitalMarkersMapRef.current.set(h.id, marker);
        boundsPoints.push([mLat, mLng]);
      });
    });
    }

    // Ambulance Provider Dispatch Desk Markers (Purple / Violet Station Pin)
    if (showAmbulanceProvidersLayer) {
      const validAmbulances = ambulanceProviders.filter((a) => isValidCoord(a.lat, a.lng));

      validAmbulances.forEach((amb) => {
        let mLat = amb.lat;
        let mLng = amb.lng;

        // Check if hospital is nearby to prevent occlusion on shared campuses
        const nearHospital = validHospitals.find(
          (h) => Math.abs(h.lat - amb.lat) < 0.0003 && Math.abs(h.lng - amb.lng) < 0.0003
        );
        if (nearHospital) {
          mLat += 0.00022;
          mLng += 0.00022;
        }

        const isSelected = selectedAmbulanceProviderId === amb.id;
        const isHelpline = amb.isHelpline || ['108', '112', '102'].includes(amb.contactNumber);

        const marker = L.marker([mLat, mLng], {
          icon: createAmbulanceProviderIcon(isSelected, isHelpline),
          zIndexOffset: isSelected ? 1000 : 2,
        }).addTo(map);

        marker.bindTooltip(amb.name, {
          direction: 'top',
          offset: [0, -32],
          className: 'll-map-tooltip',
        });

        const opBadge = isHelpline
          ? '<div style="font-size:10px;font-weight:bold;color:#dc2626;background:#fef2f2;padding:2px 6px;border-radius:4px;display:inline-block;margin-bottom:3px;">🚨 STATUTORY 108 EMERGENCY HELPLINE</div>'
          : amb.isHospitalAffiliated || amb.operatorType === 'HOSPITAL_OPERATED'
          ? `<div style="font-size:10px;font-weight:bold;color:#7c3aed;background:#f5f3ff;padding:2px 6px;border-radius:4px;display:inline-block;margin-bottom:3px;">🏥 ${amb.linkedHospitalName ? amb.linkedHospitalName + ' Fleet' : 'Hospital Dedicated Fleet'}</div>`
          : amb.operatorType === 'NGO_CHARITABLE'
          ? '<div style="font-size:10px;font-weight:bold;color:#047857;background:#ecfdf5;padding:2px 6px;border-radius:4px;display:inline-block;margin-bottom:3px;">🤝 Charitable / NGO Ambulance</div>'
          : '<div style="font-size:10px;font-weight:bold;color:#6b21a8;background:#faf5ff;padding:2px 6px;border-radius:4px;display:inline-block;margin-bottom:3px;">🚑 Verified 24x7 Ambulance Dispatch Desk</div>';

        const distText = amb.distanceLabel
          ? `<div style="color:#64748b;font-size:11px;margin-top:2px;font-weight:500;">${amb.distanceLabel}</div>`
          : '';

        const servicesBadges = Array.isArray(amb.advertisedServiceTypes) && amb.advertisedServiceTypes.length > 0
          ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;">
              ${amb.advertisedServiceTypes.slice(0, 3).map((s) => `<span style="font-size:9px;background:#f1f5f9;color:#334155;padding:1px 5px;border-radius:4px;font-weight:600;">${s.replace(/_/g, ' ')}</span>`).join('')}
              ${amb.advertisedIcuOrVentilatorCapability ? '<span style="font-size:9px;background:#ede9fe;color:#6d28d9;padding:1px 5px;border-radius:4px;font-weight:700;">ICU / Ventilator</span>' : ''}
            </div>`
          : '';

        const callButton = `<div style="margin-top:6px;">
          <a href="tel:${amb.contactNumber}" style="display:block;text-align:center;color:#ffffff;background:#7c3aed;font-size:11.5px;font-weight:bold;text-decoration:none;padding:5px 8px;border-radius:6px;box-shadow:0 1px 3px rgba(124,58,237,0.35);">
            📞 Call Dispatch: ${amb.contactNumber}
          </a>
        </div>`;

        const addressText = amb.address
          ? `<div style="color:#94a3b8;font-size:10px;margin-top:4px;line-height:1.3;">${amb.address}</div>`
          : '';

        marker.bindPopup(`
          <div style="font-family:system-ui,-apple-system,sans-serif; min-width: 200px; max-width: 260px; padding: 2px;">
            ${opBadge}
            <h4 style="font-weight:bold;margin:0 0 3px;font-size:13px;color:#0f172a;line-height:1.3;">${amb.name}</h4>
            ${distText}
            ${servicesBadges}
            ${callButton}
            ${addressText}
          </div>
        `);

        marker.on('click', () => {
          if (isValidCoord(mLat, mLng)) {
            map.flyTo([mLat, mLng], 16, { animate: true, duration: 1.0 });
          }
          if (onSelectAmbulanceProvider) {
            onSelectAmbulanceProvider(amb.id);
          }
        });

        markersRef.current.push(marker);
        ambulanceProviderMarkersMapRef.current.set(amb.id, marker);
        boundsPoints.push([mLat, mLng]);
      });
    }

    // Assigned Driver Marker
    if (isValidCoord(driverLoc?.[0], driverLoc?.[1])) {
      const driverMarker = L.marker([driverLoc![0], driverLoc![1]], {
        icon: createAmbulanceMarkerIcon({
          id: 'driver',
          vehicleNumber: 'Active Rig',
          operationalStatus: 'AVAILABLE',
        }),
      })
        .addTo(map)
        .bindPopup('<b>Assigned Emergency Ambulance</b><br/><span style="font-size:11px;color:#059669;">Transmitting telemetry</span>');

      markersRef.current.push(driverMarker);
      boundsPoints.push([driverLoc![0], driverLoc![1]]);
    }

    // Ambulances List Markers
    ambulances.forEach((amb) => {
      const aLat = amb.lat ?? amb.currentLat;
      const aLng = amb.lng ?? amb.currentLng;
      if (!isValidCoord(aLat, aLng)) return;

      const ambMarker = L.marker([aLat!, aLng!], {
        icon: createAmbulanceMarkerIcon(amb),
      }).addTo(map);

      ambMarker.bindPopup(`
        <div style="font-family:system-ui,sans-serif; min-width: 150px; padding: 2px;">
          <div style="font-weight:bold;font-size:12px;color:#0f172a;">Ambulance: ${amb.vehicleNumber}</div>
          <div style="font-size:11px;color:#475569;margin-top:2px;"><b>Status:</b> ${amb.operationalStatus || 'AVAILABLE'}</div>
          <div style="font-size:10px;color:#64748b;margin-top:2px;"><b>Data Feed:</b> ${amb.dataFreshness || 'LIVE'}</div>
        </div>
      `);

      markersRef.current.push(ambMarker);
      boundsPoints.push([aLat!, aLng!]);
    });

    // Nearby Available Drivers
    nearbyDrivers.forEach((amb) => {
      if (!isValidCoord(amb.currentLat, amb.currentLng)) return;
      if (
        driverLoc &&
        Math.abs(amb.currentLat - driverLoc[0]) < 0.0001 &&
        Math.abs(amb.currentLng - driverLoc[1]) < 0.0001
      ) {
        return;
      }

      const ambMarker = L.marker([amb.currentLat, amb.currentLng], {
        icon: createAmbulanceMarkerIcon({
          id: amb.vehicleNumber,
          vehicleNumber: amb.vehicleNumber,
          operationalStatus: 'AVAILABLE',
        }),
      })
        .addTo(map)
        .bindPopup(`<b>Available Ambulance:</b> ${amb.vehicleNumber}`);

      markersRef.current.push(ambMarker);
      boundsPoints.push([amb.currentLat, amb.currentLng]);
    });

    // Auto-fit bounds within sensible zoom limits (only when NO specific facility is selected)
    if (!selectedHospitalId && !selectedAmbulanceProviderId) {
      if (boundsPoints.length > 1) {
        try {
          map.fitBounds(L.latLngBounds(boundsPoints), {
            padding: [40, 40],
            maxZoom: 15,
            animate: true,
          });
        } catch (e) {
          // Fallback
        }
      } else if (boundsPoints.length === 1) {
        map.setView(boundsPoints[0], zoom, { animate: true });
      }
    } else if (selectedHospitalId) {
      const selectedMarker = hospitalMarkersMapRef.current.get(selectedHospitalId);
      if (selectedMarker) {
        selectedMarker.openPopup();
        const latLng = selectedMarker.getLatLng();
        if (isValidCoord(latLng.lat, latLng.lng)) {
          map.flyTo([latLng.lat, latLng.lng], 16, {
            animate: true,
            duration: 1.0,
          });
        }
      }
    } else if (selectedAmbulanceProviderId) {
      const selectedMarker = ambulanceProviderMarkersMapRef.current.get(selectedAmbulanceProviderId);
      if (selectedMarker) {
        selectedMarker.openPopup();
        const latLng = selectedMarker.getLatLng();
        if (isValidCoord(latLng.lat, latLng.lng)) {
          map.flyTo([latLng.lat, latLng.lng], 16, {
            animate: true,
            duration: 1.0,
          });
        }
      }
    }

    // Directions & Route calculation
    const fetchDirectionsRoute = async () => {
      let start: [number, number] | null = null;
      let end: [number, number] | null = null;

      if (driverLoc && patientLoc && (!status || status === 'ACCEPTED' || status === 'ARRIVING')) {
        start = driverLoc;
        end = patientLoc;
      } else if (patientLoc && hospitalLoc && status === 'IN_TRANSIT') {
        start = patientLoc;
        end = hospitalLoc;
      } else if (driverLoc && hospitalLoc && (status === 'AT_HOSPITAL' || status === 'COMPLETED')) {
        start = driverLoc;
        end = hospitalLoc;
      } else if (patientLoc && nearbyDrivers.length > 0) {
        start = [nearbyDrivers[0].currentLat, nearbyDrivers[0].currentLng];
        end = patientLoc;
      } else if (patientLoc && selectedHospitalId) {
        const selHosp = hospitals.find((h) => h.id === selectedHospitalId);
        if (selHosp && isValidCoord(selHosp.lat, selHosp.lng)) {
          start = patientLoc;
          end = [selHosp.lat, selHosp.lng];
        }
      } else if (patientLoc && selectedAmbulanceProviderId) {
        const selAmb = ambulanceProviders.find((a) => a.id === selectedAmbulanceProviderId);
        if (selAmb && isValidCoord(selAmb.lat, selAmb.lng)) {
          start = patientLoc;
          end = [selAmb.lat, selAmb.lng];
        }
      }

      if (
        !start ||
        !end ||
        !isValidCoord(start[0], start[1]) ||
        !isValidCoord(end[0], end[1])
      ) {
        setRouteStats(null);
        onRouteCalculated?.(null);
        return;
      }

      try {
        const result = await fetchDirections(start, end, activeToken, profile);
        const latLngs = result.coordinates.map((c) => L.latLng(c[0], c[1]));

        if (result.isStraightLine) {
          const straightLine = L.polyline(latLngs, {
            color: '#f59e0b',
            weight: 3.5,
            opacity: 0.85,
            dashArray: '8, 8',
          }).addTo(map);

          polylineLayersRef.current = [straightLine];
        } else {
          const casing = L.polyline(latLngs, {
            color: '#0284c7',
            weight: 6,
            opacity: 0.45,
            lineJoin: 'round',
            lineCap: 'round',
          }).addTo(map);

          const core = L.polyline(latLngs, {
            color: '#38bdf8',
            weight: 3.5,
            opacity: 0.95,
            lineJoin: 'round',
            lineCap: 'round',
          }).addTo(map);

          polylineLayersRef.current = [casing, core];
        }

        setRouteStats(result);
        onRouteCalculated?.(result);
      } catch (e) {
        setRouteStats(null);
        onRouteCalculated?.(null);
      }
    };

    fetchDirectionsRoute();
  }, [
    patientLoc?.[0],
    patientLoc?.[1],
    driverLoc?.[0],
    driverLoc?.[1],
    hospitalLoc?.[0],
    hospitalLoc?.[1],
    status,
    nearbyDrivers.length,
    hospitals,
    ambulances,
    ambulanceProviders,
    selectedHospitalId,
    selectedAmbulanceProviderId,
    showHospitalsLayer,
    showAmbulanceProvidersLayer,
    activeToken,
    profile,
  ]);

  return (
    <div className={`w-full h-full relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 select-none ${className}`}>
      <div ref={mapRef} className="w-full h-full min-h-[220px] z-0" />

      {/* Recenter Map Control */}
      <div className="absolute top-3 right-3 z-[400]">
        <button
          type="button"
          onClick={handleRecenter}
          title="Recenter Map"
          aria-label="Recenter map to patient or Nagpur center"
          className="p-2 rounded-xl bg-white/95 dark:bg-slate-900/95 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/90 dark:border-slate-700/90 shadow-md backdrop-blur-md transition-all cursor-pointer flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <LocateFixed className="w-4 h-4 text-teal-600 dark:text-teal-400" />
        </button>
      </div>

      {/* Layer Filter Controls */}
      {showLayerControls && (hospitals.length > 0 || ambulanceProviders.length > 0) && (
        <div className="absolute top-3 left-3 z-[400] bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-slate-800 shadow-md rounded-xl p-1 flex flex-wrap items-center gap-1.5 backdrop-blur-md text-[11px] font-semibold select-none max-w-[calc(100%-60px)]">
          {hospitals.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHospitalsLayer((prev) => !prev)}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                showHospitalsLayer
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                  : 'bg-transparent text-slate-400 opacity-60'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${showHospitalsLayer ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
              <span>Hospitals ({hospitals.length})</span>
            </button>
          )}
          {ambulanceProviders.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAmbulanceProvidersLayer((prev) => !prev)}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                showAmbulanceProvidersLayer
                  ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800'
                  : 'bg-transparent text-slate-400 opacity-60'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${showAmbulanceProvidersLayer ? 'bg-purple-600' : 'bg-slate-400'}`}></span>
              <span>Ambulance Stations ({ambulanceProviders.length})</span>
            </button>
          )}
          {ambulances.length > 0 && (
            <span className="px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1 text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
              <span>Live Rigs ({ambulances.length})</span>
            </span>
          )}
        </div>
      )}

      {/* Tile Offline Warning Banner */}
      {tileError && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-amber-500/95 text-slate-950 font-bold px-3 py-1 rounded-full text-[11px] shadow-lg flex items-center gap-1.5 z-[400] backdrop-blur-sm">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>OpenStreetMap Standard tile server unreachable.</span>
        </div>
      )}

      {/* Navigation & Direction HUD */}
      {routeStats && (
        <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 bg-slate-900/95 border border-slate-800 text-white p-3.5 sm:p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xl backdrop-blur-md z-[400] animate-fade-in max-w-lg">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                routeStats.isStraightLine
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                  : 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
              }`}
            >
              <Navigation className="w-4 h-4 animate-pulse" />
            </div>
            <div className="text-left min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 uppercase font-extrabold tracking-wider truncate">
                  {status === 'IN_TRANSIT'
                    ? 'Heading to ER Hospital'
                    : status === 'ACCEPTED' || status === 'ARRIVING'
                    ? 'Ambulance En Route to You'
                    : selectedHospitalId
                    ? `Route to ${hospitals.find((h) => h.id === selectedHospitalId)?.name || 'Selected Facility'}`
                    : selectedAmbulanceProviderId
                    ? `Route to ${ambulanceProviders.find((a) => a.id === selectedAmbulanceProviderId)?.name || 'Ambulance Dispatch Desk'}`
                    : 'Nearest Emergency Facility'}
                </span>
                <span
                  className={`text-[9px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                    routeStats.isStraightLine
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                  }`}
                >
                  {routeStats.provider}
                </span>
              </div>
              {routeStats.isStraightLine ? (
                <p className="text-[11px] text-amber-300/90 mt-0.5 truncate font-medium">
                  {routeStats.disclaimer || 'Direct straight-line distance; road routing offline'}
                </p>
              ) : routeStats.nextInstruction ? (
                <p className="text-xs font-bold text-slate-100 flex items-center gap-1 mt-0.5 truncate">
                  <Compass className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">{routeStats.nextInstruction}</span>
                </p>
              ) : (
                <p className="text-xs font-bold text-slate-200 mt-0.5 truncate">
                  {routeStats.summary ? `Via ${routeStats.summary}` : 'Live Real-Time GPS Directions'}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 text-right shrink-0 self-end sm:self-center">
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-bold block">
                {routeStats.isStraightLine ? 'Straight-line' : 'Road Distance'}
              </span>
              <span className={`text-xs font-extrabold ${routeStats.isStraightLine ? 'text-amber-400' : 'text-cyan-400'}`}>
                {routeStats.distanceKm} km
              </span>
            </div>
            <div className="border-l border-slate-800 h-6" />
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Travel Time</span>
              <span
                className={`text-xs font-extrabold ${
                  routeStats.durationMins !== null ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {routeStats.durationMins !== null ? `${routeStats.durationMins} mins` : 'Unavailable'}
              </span>
            </div>
            {(selectedHospitalId || selectedAmbulanceProviderId) && (
              <a
                href={
                  (() => {
                    if (selectedHospitalId) {
                      const h = hospitals.find((item) => item.id === selectedHospitalId);
                      return h && isValidCoord(h.lat, h.lng)
                        ? `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`
                        : undefined;
                    }
                    if (selectedAmbulanceProviderId) {
                      const a = ambulanceProviders.find((item) => item.id === selectedAmbulanceProviderId);
                      return a && isValidCoord(a.lat, a.lng)
                        ? `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}`
                        : undefined;
                    }
                    return undefined;
                  })()
                }
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold flex items-center gap-1 shadow-sm transition-all cursor-pointer shrink-0 ml-1"
                title="Get turn-by-turn directions in external maps"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Navigate</span>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LeafletMap;
