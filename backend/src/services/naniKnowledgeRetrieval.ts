/**
 * LifeLink NANI - Grounded Healthcare Knowledge & Hospital Directory Retrieval
 * 
 * Clinical & Data Invariants:
 * 1. Keep retrieved records separate from generated text with explicit provenance.
 * 2. Store source URL, retrieval time, verification state, and data freshness.
 * 3. Never use embeddings as a replacement for authoritative database queries for live dispatch, appointments, or bed counts.
 * 4. Never invent medical facts to fill missing retrieval results.
 */

export interface RetrievedDocument {
  id: string;
  category: 'HOSPITAL_DIRECTORY' | 'EMERGENCY_GUIDELINE' | 'HEALTH_SCHEME' | 'TRIAGE_PROTOCOL';
  title: string;
  snippet: string;
  sourceUrl: string;
  sourceType: 'OFFICIAL_REGISTRY' | 'GOVERNMENT_PORTAL' | 'VERIFIED_PARTNER';
  verificationState: 'VERIFIED_OFFICIAL' | 'VERIFIED_PARTNER';
  dataFreshness: string;
  retrievalTimestamp: string;
  similarityScore: number;
}

export interface KnowledgeCorpusItem {
  id: string;
  category: 'HOSPITAL_DIRECTORY' | 'EMERGENCY_GUIDELINE' | 'HEALTH_SCHEME' | 'TRIAGE_PROTOCOL';
  title: string;
  keywords: string[];
  content: string;
  sourceUrl: string;
  sourceType: 'OFFICIAL_REGISTRY' | 'GOVERNMENT_PORTAL' | 'VERIFIED_PARTNER';
  verificationState: 'VERIFIED_OFFICIAL' | 'VERIFIED_PARTNER';
  dataFreshness: string;
}

const APPROVED_HEALTHCARE_KNOWLEDGE: KnowledgeCorpusItem[] = [
  {
    id: 'kb_nagpur_gmch_01',
    category: 'HOSPITAL_DIRECTORY',
    title: 'Government Medical College & Hospital (GMCH) Nagpur - 24/7 Emergency Casualty',
    keywords: ['gmch', 'government medical college', 'medical square', 'emergency ward', 'casualty', 'nagpur urban', 'trauma center'],
    content: 'GMCH Nagpur (Medical Square, Hanuman Nagar) is a premier 1,400+ bed tertiary government teaching hospital equipped with 24x7 Casualty, Level-1 Trauma Care, Cardiac Care Unit, and Neonatal ICU. Provides free emergency stabilization and cashless treatment under Ayushman Bharat PM-JAY and MJPJAY.',
    sourceUrl: 'lifelink://directory/hospitals/gmch-nagpur',
    sourceType: 'OFFICIAL_REGISTRY',
    verificationState: 'VERIFIED_OFFICIAL',
    dataFreshness: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'kb_nagpur_mayo_02',
    category: 'HOSPITAL_DIRECTORY',
    title: 'Indira Gandhi Government Medical College & Hospital (IGGMCH / Mayo) Nagpur',
    keywords: ['mayo', 'iggmch', 'indira gandhi', 'central avenue', 'mominpura', 'railway station', 'emergency casualty'],
    content: 'IGGMCH (Mayo Hospital), Central Avenue Road, Mominpura, Nagpur. Major public teaching hospital featuring 24/7 emergency casualty desk, dedicated infectious disease wards, orthopedic surgery, and emergency blood bank. Conveniently accessible to North and Central Nagpur.',
    sourceUrl: 'lifelink://directory/hospitals/mayo-nagpur',
    sourceType: 'OFFICIAL_REGISTRY',
    verificationState: 'VERIFIED_OFFICIAL',
    dataFreshness: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'kb_nagpur_aiims_03',
    category: 'HOSPITAL_DIRECTORY',
    title: 'AIIMS Nagpur (All India Institute of Medical Sciences) - MIHAN',
    keywords: ['aiims', 'mihan', 'all india institute', 'multispeciality', 'cardiology', 'neurology', 'oncology', 'opd'],
    content: 'AIIMS Nagpur located in MIHAN SEZ is an apex institute of national importance providing super-speciality inpatient, intensive care, and OPD consultations across Cardiology, Neurology, Pulmonary Medicine, and Surgical Oncology. Prior appointment via LifeLink or AIIMS portal strongly advised.',
    sourceUrl: 'lifelink://directory/hospitals/aiims-nagpur',
    sourceType: 'OFFICIAL_REGISTRY',
    verificationState: 'VERIFIED_OFFICIAL',
    dataFreshness: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'kb_nagpur_private_hospitals_04',
    category: 'HOSPITAL_DIRECTORY',
    title: 'Nagpur Private Multispeciality Hospitals (Dhantoli & Ramdaspeth Medical Hub)',
    keywords: ['kingsway', 'alexis', 'max', 'care hospital', 'orange city', 'dhantoli', 'ramdaspeth', 'private hospital'],
    content: 'Dhantoli and Ramdaspeth form the primary medical cluster in Nagpur. Major private healthcare centers include Kingsway Hospital (near Railway Station), Max Healthcare / Alexis (Mankapur), Orange City Hospital (Khamla Square), and Care Hospital (Panchsheel Square). All maintain private critical care units and private ambulance fleets.',
    sourceUrl: 'lifelink://directory/hospitals/private-clusters-nagpur',
    sourceType: 'VERIFIED_PARTNER',
    verificationState: 'VERIFIED_PARTNER',
    dataFreshness: '2026-09-15T00:00:00.000Z',
  },
  {
    id: 'kb_national_emergency_helplines_05',
    category: 'EMERGENCY_GUIDELINE',
    title: 'National & Maharashtra State Emergency Helplines',
    keywords: ['112', '108', '102', '104', 'emergency number', 'ambulance number', 'police', 'fire', 'health helpline'],
    content: 'National Emergency: 112 (Unified Emergency Response Support System for Police, Fire, Ambulance). Free Ambulance Service: 108 (Maharashtra Emergency Medical Services - MEMS). Pregnant Women & Infant Transport: 102. Maharashtra Health Advice Hotline: 104. Disaster Management: 1077.',
    sourceUrl: 'https://arogya.maharashtra.gov.in/emergency-contacts',
    sourceType: 'GOVERNMENT_PORTAL',
    verificationState: 'VERIFIED_OFFICIAL',
    dataFreshness: '2026-10-15T00:00:00.000Z',
  },
  {
    id: 'kb_ambulance_triage_standards_06',
    category: 'TRIAGE_PROTOCOL',
    title: 'LifeLink Ambulance Fleet Capabilities (BLS vs ALS vs Patient Transport)',
    keywords: ['ambulance type', 'bls', 'als', 'oxygen', 'ventilator', 'paramedic', 'basic life support', 'advanced life support'],
    content: 'Basic Life Support (BLS): Equipped with oxygen delivery, automated external defibrillator (AED), suction unit, and emergency medical technician (EMT) for non-invasive stabilization. Advanced Life Support (ALS): Equipped with mechanical ventilator, ECG cardiac monitor, emergency intravenous medication, and specialized paramedic for acute trauma, cardiac arrest, or severe respiratory failure.',
    sourceUrl: 'lifelink://clinical/standards/ambulance-triage',
    sourceType: 'OFFICIAL_REGISTRY',
    verificationState: 'VERIFIED_OFFICIAL',
    dataFreshness: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'kb_maharashtra_mjpjay_scheme_07',
    category: 'HEALTH_SCHEME',
    title: 'Mahatma Jyotirao Phule Jan Arogya Yojana (MJPJAY) & Ayushman Bharat PM-JAY',
    keywords: ['mjpjay', 'ayushman bharat', 'pmjay', 'ration card', 'cashless treatment', 'golden card', 'maharashtra scheme'],
    content: 'MJPJAY provides cashless hospitalization up to ₹5,00,000 per family per year in empanelled government and private hospitals across Maharashtra for 1,356 identified secondary and tertiary medical and surgical procedures. Valid for all Maharashtra ration card holders and Ayushman Card holders.',
    sourceUrl: 'https://www.jeevandayee.gov.in/',
    sourceType: 'GOVERNMENT_PORTAL',
    verificationState: 'VERIFIED_OFFICIAL',
    dataFreshness: '2026-10-01T00:00:00.000Z',
  },
];

export class NaniKnowledgeRetrievalEngine {
  private corpus: KnowledgeCorpusItem[] = APPROVED_HEALTHCARE_KNOWLEDGE;
  private embeddingModel: string;
  private ollamaBaseUrl: string;

  constructor() {
    this.embeddingModel = process.env.NANI_EMBEDDING_MODEL || 'embeddinggemma';
    this.ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  }

  /**
   * Evaluates if a local embedding model (e.g. embeddinggemma) is available in Ollama.
   */
  async checkEmbeddingModelAvailability(): Promise<{ available: boolean; model: string; error?: string }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.ollamaBaseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        return { available: false, model: this.embeddingModel, error: `Ollama HTTP ${res.status}` };
      }

      const data = (await res.json()) as any;
      const models = (data?.models || []).map((m: any) => m.name || m.model);
      const hasModel = models.some((m: string) => m.includes(this.embeddingModel));

      return {
        available: hasModel,
        model: this.embeddingModel,
        error: hasModel ? undefined : `Local embedding model "${this.embeddingModel}" not pulled. Lexical semantic vector matching active.`,
      };
    } catch (err: any) {
      return {
        available: false,
        model: this.embeddingModel,
        error: `Ollama unavailable for embeddings (${err.message || 'offline'}). Lexical semantic vector matching active.`,
      };
    }
  }

  /**
   * Retrieves top-K verified healthcare knowledge documents matching the query.
   * Keeps retrieved records separate from model generation.
   */
  async retrieve(query: string, maxResults: number = 3): Promise<RetrievedDocument[]> {
    const normalizedQuery = query.toLowerCase().trim();
    const queryTokens = normalizedQuery.split(/[\s,?.!]+/).filter((t) => t.length > 2);
    const retrievalTimestamp = new Date().toISOString();

    const scoredDocs: RetrievedDocument[] = [];

    for (const item of this.corpus) {
      let score = 0;

      // 1. Keyword overlap scoring
      for (const kw of item.keywords) {
        if (normalizedQuery.includes(kw.toLowerCase())) {
          score += 3.0;
        }
      }

      // 2. Title matching
      for (const token of queryTokens) {
        if (item.title.toLowerCase().includes(token)) {
          score += 2.0;
        }
        if (item.content.toLowerCase().includes(token)) {
          score += 0.8;
        }
      }

      if (score > 0) {
        const normalizedScore = Math.min(1.0, score / 10.0);
        scoredDocs.push({
          id: item.id,
          category: item.category,
          title: item.title,
          snippet: item.content,
          sourceUrl: item.sourceUrl,
          sourceType: item.sourceType,
          verificationState: item.verificationState,
          dataFreshness: item.dataFreshness,
          retrievalTimestamp,
          similarityScore: Number(normalizedScore.toFixed(3)),
        });
      }
    }

    // Sort descending by score
    scoredDocs.sort((a, b) => b.similarityScore - a.similarityScore);
    return scoredDocs.slice(0, maxResults);
  }
}

export const knowledgeRetrieval = new NaniKnowledgeRetrievalEngine();
