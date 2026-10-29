/**
 * NANI Phase 1: Deterministic Emergency Safety Guardrail
 * 
 * Clinical Safety Rule: The LLM is NEVER the emergency classifier of record.
 * This guardrail runs completely deterministically BEFORE any AI model invocation,
 * ensuring zero conversational delay and 100% availability even if models are offline or timing out.
 */

export type EmergencySafetyLevel = 'CRITICAL_EMERGENCY' | 'URGENT_ATTENTION' | 'NON_EMERGENCY';

export interface EmergencySafetyState {
  safetyLevel: EmergencySafetyLevel;
  requiresUrgentGuidance: boolean;
  detectedKeywords: string[];
  guidance: string;
  emergencyNumber: string;
  ambulanceNumber: string;
  dispatchAvailable: boolean;
  dispatchRequestId?: string;
}

// 1. Critical acute symptoms requiring immediate 112 / SOS action
const CRITICAL_KEYWORDS = [
  // English
  'chest pain',
  'chest pressure',
  'crushing chest',
  'heart attack',
  'short of breath',
  'shortness of breath',
  'difficulty breathing',
  'cannot breathe',
  'cant breathe',
  'stopped breathing',
  'no pulse',
  'unconscious',
  'unresponsive',
  'collapsed',
  'passed out',
  'fainting',
  'fainted',
  'not breathing',
  'stroke',
  'facial droop',
  'slurred speech',
  'sudden paralysis',
  'massive bleeding',
  'severe bleeding',
  'heavy bleeding',
  'artery',
  'crash victim',
  'hemorrhage',
  'coughing blood',
  'vomiting blood',
  'seizure',
  'convulsions',
  'anaphylaxis',
  'severe allergic reaction',
  'poisoning',
  'poison',
  'overdose',
  'head trauma',
  'crushed limb',
  'electric shock',
  'drowning',
  'hanging',
  'burns on face',
  'severe burn',

  // Hindi (Devanagari)
  'सीने में दर्द',
  'छाती में दर्द',
  'छाती में भारीपन',
  'दिल का दौरा',
  'हार्ट अटैक',
  'सांस लेने में तकलीफ',
  'सांस लेने में',
  'सांस फूल',
  'सांस नहीं',
  'दम घुट',
  'दम घुटना',
  'बेहोश',
  'बेहोशी',
  'अचेत',
  'लकवा',
  'पक्षघात',
  'अत्यधिक रक्तस्राव',
  'खून बहना',
  'खून बह',
  'खून की उल्टी',
  'दौरा पड़ना',
  'मिरगी का दौरा',
  'जहर खा लिया',
  'जहर',
  'कीटनाशक',
  'विषपान',
  'विष',
  'आग में',
  'जल गया',
  'झुलस गया',
  'झुलस',
  'गंभीर चोट',
  'धड़कन रुकना',
  'सीपीआर',
  'सांस नहीं आ रही',
  'सांस नहीं ले रहा',
  'साँस नहीं',

  // Hinglish / Romanized Hindi
  'zahar',
  'poison',
  'keetnashak',
  'aag me',
  'jal gaya',
  'cpr',
  'chhati me dard',
  'chhati me',
  'seene me dard',
  'seene me',
  'dil ka daura',
  'heart attack',
  'saans lene me',
  'saans nahi',
  'saans phool',
  'dam ghut',
  'behosh',
  'hosh nahi',
  'chakkar aake gir gaya',
  'khoon nikal',
  'khoon beh',
  'khoon ki ulti',
  'lakwa',
  'body sunn',
  'daura pada',
  'mirgi ka daura',
  'zahar kha liya',
  'poison',
  'dhadkan ruk gayi',
];

// 2. Urgent (non-fatal immediate, but requires fast clinical attention)
const URGENT_KEYWORDS = [
  // English
  'high fever',
  '104 fever',
  '104 degree',
  '103 fever',
  '103 degree',
  'fracture',
  'broken bone',
  'dislocated',
  'deep cut',
  'asthma attack',
  'dehydration',
  'unbearable abdominal pain',
  'severe stomach pain',

  // Hindi
  'तेज बुखार',
  '104 बुखार',
  '103 बुखार',
  'हड्डी टूटना',
  'गहरा घाव',
  'असहनीय पेट दर्द',

  // Hinglish
  'tez bukhar',
  '103 bukhar',
  '104 bukhar',
  'haddi toot',
  'fracture',
  'pet me behad tez dard',
  'deep cut',
];

/**
 * Deterministically evaluates message for clinical emergencies
 */
export function evaluateEmergencySafety(
  message: string,
  language: string = 'English'
): EmergencySafetyState {
  const normalized = (message || '').toLowerCase();
  const detectedCritical: string[] = [];
  const detectedUrgent: string[] = [];

  for (const kw of CRITICAL_KEYWORDS) {
    if (normalized.includes(kw.toLowerCase())) {
      detectedCritical.push(kw);
    }
  }

  if (detectedCritical.length > 0) {
    const isHindiOrHinglish =
      language.toLowerCase().includes('hindi') ||
      language.toLowerCase().includes('hi') ||
      detectedCritical.some((kw) => /[\u0900-\u097F]/.test(kw) || kw.includes('dard') || kw.includes('saans'));

    const guidance = isHindiOrHinglish
      ? '🚨 आपातकालीन चेतावनी (Emergency Alert): आपके द्वारा बताए गए लक्षण (जैसे सीने में दर्द, सांस में रुकावट या बेहोशी) तुरंत आपातकालीन सहायता की मांग करते हैं। नानी कोई डॉक्टर नहीं है। बातचीत में समय न गंवाएं, तुरंत 112 या 108 डायल करें या नीचे लाल SOS बटन दबाएं!'
      : '🚨 IMMEDIATE EMERGENCY NOTICE: Acute life-threatening symptoms detected. Nani is an AI assistant, not an emergency clinician or diagnostic service. Please immediately dial National Emergency 112 or 108, or press the LifeLink SOS button to dispatch emergency services immediately!';

    return {
      safetyLevel: 'CRITICAL_EMERGENCY',
      requiresUrgentGuidance: true,
      detectedKeywords: detectedCritical,
      guidance,
      emergencyNumber: '112',
      ambulanceNumber: '108',
      dispatchAvailable: true,
    };
  }

  for (const kw of URGENT_KEYWORDS) {
    if (normalized.includes(kw.toLowerCase())) {
      detectedUrgent.push(kw);
    }
  }

  if (detectedUrgent.length > 0) {
    const isHindi = language.toLowerCase().includes('hindi') || language.toLowerCase().includes('hi');
    const guidance = isHindi
      ? '⚠️ महत्वपूर्ण स्वास्थ्य सलाह: ये लक्षण गंभीर हो सकते हैं। कृपया नजदीकी अस्पताल के आपातकालीन विभाग में जाएं या डॉक्टर से तत्काल परामर्श लें।'
      : '⚠️ URGENT CLINICAL NOTICE: These symptoms require prompt medical evaluation. Please visit the nearest hospital casualty/emergency room or consult a licensed doctor.';

    return {
      safetyLevel: 'URGENT_ATTENTION',
      requiresUrgentGuidance: true,
      detectedKeywords: detectedUrgent,
      guidance,
      emergencyNumber: '112',
      ambulanceNumber: '108',
      dispatchAvailable: true,
    };
  }

  return {
    safetyLevel: 'NON_EMERGENCY',
    requiresUrgentGuidance: false,
    detectedKeywords: [],
    guidance: '',
    emergencyNumber: '112',
    ambulanceNumber: '108',
    dispatchAvailable: true,
  };
}
