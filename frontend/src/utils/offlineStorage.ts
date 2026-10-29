/**
 * LifeLink Offline Storage Utility & Safe Data Policy
 * 
 * Strict Privacy & Resilience Rules:
 * 1. ONLY safe, non-sensitive emergency resources may be cached:
 *    - Previously saved emergency contact phone numbers
 *    - Essential first-aid guides & CPR instructions
 *    - Verified regional casualty helplines (India 112, 108, Nagpur GMCH/Mayo/AIIMS)
 * 2. NEVER cache sensitive health records, full diagnoses, prescriptions, or trip GPS breadcrumb histories.
 * 3. On logout or session revocation, all cached user data MUST be immediately purged to protect shared devices.
 * 4. Never claim offline mode guarantees emergency dispatch.
 */

export interface SafeEmergencyContact {
  id?: string;
  name: string;
  phone: string;
  relationship?: string;
  isPrimary?: boolean;
}

export interface EmergencyHelpline {
  name: string;
  number: string;
  description: string;
  isNational: boolean;
  city?: string;
}

export interface FirstAidGuide {
  id: string;
  title: string;
  emergencyType: string;
  steps: string[];
  warning: string;
}

const STORAGE_KEYS = {
  SAFE_CONTACTS: 'lifelink_offline_safe_contacts',
  LAST_SYNC: 'lifelink_last_sync_timestamp',
  NETWORK_CACHE_PREFIX: 'lifelink_offline_',
};

/**
 * Standard offline first-aid guides (safe, static, life-preserving reference)
 */
export const OFFLINE_FIRST_AID_GUIDES: FirstAidGuide[] = [
  {
    id: 'cpr-adult',
    title: 'Hands-Only CPR (Cardiac Arrest)',
    emergencyType: 'CARDIAC',
    steps: [
      'Check if patient is responsive and breathing normally.',
      'Call 112 immediately or instruct a bystander to call.',
      'Place heel of one hand in the center of the chest, other hand on top.',
      'Push hard and fast in the center of the chest (100–120 compressions per minute).',
      'Allow full chest recoil between compressions; do not stop until help arrives.',
    ],
    warning: 'Immediate chest compressions save lives. Do not hesitate if patient is unresponsive.',
  },
  {
    id: 'bleeding-control',
    title: 'Severe Bleeding Control',
    emergencyType: 'TRAUMA',
    steps: [
      'Apply direct, firm pressure on the wound with a clean cloth or bandage.',
      'Maintain continuous pressure without lifting to inspect.',
      'If bleeding soaks through, apply additional cloth on top without removing original.',
      'Keep patient lying down and elevate the injured limb above heart level if no fracture.',
    ],
    warning: 'Do not remove deeply embedded objects; apply pressure around them.',
  },
  {
    id: 'stroke-fast',
    title: 'Stroke FAST Protocol',
    emergencyType: 'NEUROLOGICAL',
    steps: [
      'F - Face: Ask person to smile. Does one side of the face droop?',
      'A - Arms: Ask person to raise both arms. Does one arm drift downward?',
      'S - Speech: Ask person to repeat a simple phrase. Is speech slurred?',
      'T - Time: If ANY sign is present, dial 112 immediately. Note time symptoms began.',
    ],
    warning: 'Stroke is time-critical. Every minute saves brain tissue. Do not give aspirin or water.',
  },
  {
    id: 'choking-adult',
    title: 'Choking Protocol (Heimlich Maneuver)',
    emergencyType: 'RESPIRATORY',
    steps: [
      'Stand behind person, wrap arms around waist.',
      'Make a fist with one hand, place thumb side just above navel.',
      'Grasp fist with other hand and give quick, upward thrusts into abdomen.',
      'Repeat until object is dislodged or person becomes unconscious.',
      'If unconscious, lower to ground and begin CPR immediately.',
    ],
    warning: 'For pregnant individuals or infants, use chest thrusts instead of abdominal thrusts.',
  },
];

/**
 * Verified Official Indian Emergency Helplines
 */
export const OFFICIAL_EMERGENCY_HELPLINES: EmergencyHelpline[] = [
  {
    name: 'National Emergency Helpline (Pan-India)',
    number: '112',
    description: 'Unified national emergency helpline for Police, Fire, and Ambulance across India.',
    isNational: true,
  },
  {
    name: 'National Ambulance Service',
    number: '108',
    description: 'Emergency Medical Service ambulance dispatch across Maharashtra and India.',
    isNational: true,
  },
  {
    name: 'Mother and Child Helpline',
    number: '102',
    description: 'Free transport for pregnant mothers and newborns.',
    isNational: true,
  },
  {
    name: 'Government Medical College & Hospital (GMCH) Nagpur Casualty',
    number: '07122744400',
    description: 'Level 1 Government Trauma and Emergency Center in Nagpur.',
    isNational: false,
    city: 'Nagpur',
  },
  {
    name: 'Indira Gandhi Govt Medical College (Mayo) Hospital Casualty',
    number: '07122728621',
    description: 'Central Nagpur 24x7 Emergency and Critical Care Casualty.',
    isNational: false,
    city: 'Nagpur',
  },
  {
    name: 'AIIMS Nagpur Emergency & Trauma Care',
    number: '07122982888',
    description: 'MIHAN Nagpur Tertiary Emergency Hospital.',
    isNational: false,
    city: 'Nagpur',
  },
];

/**
 * Save non-sensitive emergency contacts safely in offline cache
 */
export function saveSafeEmergencyContacts(contacts: SafeEmergencyContact[]): void {
  try {
    const sanitized = (contacts || []).map((c) => ({
      id: c.id,
      name: c.name ? String(c.name).slice(0, 80) : '',
      phone: c.phone ? String(c.phone).slice(0, 20) : '',
      relationship: c.relationship ? String(c.relationship).slice(0, 40) : '',
      isPrimary: Boolean(c.isPrimary),
    }));
    localStorage.setItem(STORAGE_KEYS.SAFE_CONTACTS, JSON.stringify(sanitized));
  } catch (err) {
    console.warn('Unable to persist safe emergency contacts to offline storage:', err);
  }
}

/**
 * Retrieve saved non-sensitive emergency contacts from offline cache
 */
export function getSafeEmergencyContacts(): SafeEmergencyContact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SAFE_CONTACTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Record timestamp of authoritative sync with server
 */
export function recordLastSyncTimestamp(source: string = 'server'): void {
  try {
    const payload = {
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      source,
    };
    localStorage.setItem(STORAGE_KEYS.LAST_SYNC, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

/**
 * Retrieve timestamp of last authoritative server sync
 */
export function getLastSyncInfo(): { timestamp: number; iso: string; source: string; ageSeconds: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LAST_SYNC);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ageSeconds = Math.max(0, Math.floor((Date.now() - parsed.timestamp) / 1000));
    return { ...parsed, ageSeconds };
  } catch {
    return null;
  }
}

/**
 * Format relative sync age in human-readable IST/local format
 */
export function formatSyncAge(timestampMs?: number): string {
  if (!timestampMs) return 'Never synchronized';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

/**
 * Complete cache eviction and wipe on logout to protect shared devices
 */
export function clearOfflineCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.SAFE_CONTACTS);
    localStorage.removeItem(STORAGE_KEYS.LAST_SYNC);

    // Evict any other lifelink_offline_* keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEYS.NETWORK_CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));

    // Clear session storage as well
    sessionStorage.clear();
  } catch (err) {
    console.warn('Error clearing offline cache:', err);
  }
}
