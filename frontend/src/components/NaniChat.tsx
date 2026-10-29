import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  MessageCircle,
  X,
  Send,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Sparkles,
  AlertTriangle,
  RotateCcw,
  Languages,
  Info,
  PhoneCall,
  ShieldAlert,
  Play,
  Square,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Check,
  Radio
} from 'lucide-react';

export interface SupportedLanguage {
  code: string;
  name: string;
  nativeName: string;
  bcp47: string;
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en-US', name: 'English', nativeName: 'English', bcp47: 'en-US' },
  { code: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी', bcp47: 'hi-IN' },
  { code: 'mr-IN', name: 'Marathi', nativeName: 'मराठी', bcp47: 'mr-IN' },
  { code: 'bn-IN', name: 'Bengali', nativeName: 'বাংলা', bcp47: 'bn-IN' },
  { code: 'te-IN', name: 'Telugu', nativeName: 'తెలుగు', bcp47: 'te-IN' },
  { code: 'ta-IN', name: 'Tamil', nativeName: 'தமிழ்', bcp47: 'ta-IN' },
  { code: 'es-ES', name: 'Spanish', nativeName: 'Español', bcp47: 'es-ES' },
  { code: 'fr-FR', name: 'French', nativeName: 'Français', bcp47: 'fr-FR' },
  { code: 'de-DE', name: 'German', nativeName: 'Deutsch', bcp47: 'de-DE' },
  { code: 'ar-SA', name: 'Arabic', nativeName: 'العربية', bcp47: 'ar-SA' },
];

export interface ChatMessage {
  id: string;
  sender: 'user' | 'nani';
  text: string;
  timestamp: Date;
  provider?: string;
  isEmergency?: boolean;
  failed?: boolean;
  toolExecution?: any;
}

export interface ModelStatusInfo {
  provider: string;
  activeProvider?: string;
  providerMode?: string;
  model: string;
  available: boolean;
  latencyMs?: number;
  zeroCost: boolean;
  toolsEnabled?: string[];
  installedModels?: string[];
  promptVersion?: string;
  rateLimited?: boolean;
  cooldownRemainingSec?: number;
  groqConfigured?: boolean;
  ollamaConfigured?: boolean;
  error?: string;
}

export type MicState =
  | 'idle'
  | 'requesting'
  | 'listening'
  | 'denied'
  | 'unsupported'
  | 'timeout'
  | 'network_error'
  | 'error';

export const NaniChat: React.FC = () => {
  const { apiFetch, user } = useAuth();

  // Widget state
  const [isOpen, setIsOpen] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [micState, setMicState] = useState<MicState>('idle');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isEmergencyDetected, setIsEmergencyDetected] = useState(false);
  const [aiProvider, setAiProvider] = useState<string>('local_fallback');
  const [modelStatus, setModelStatus] = useState<ModelStatusInfo | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<any | null>(null);
  const [confirmationExecuting, setConfirmationExecuting] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showSpeechInfoModal, setShowSpeechInfoModal] = useState(false);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);

  // External AI (Groq cloud) Consent state
  const [allowExternalAi, setAllowExternalAi] = useState<boolean>(() => {
    return localStorage.getItem('nani_allow_external_ai') === 'true';
  });

  const handleToggleExternalAi = (val: boolean) => {
    setAllowExternalAi(val);
    localStorage.setItem('nani_allow_external_ai', String(val));
  };

  // Selected language state (persisted)
  const [selectedLang, setSelectedLang] = useState<SupportedLanguage>(() => {
    const saved = localStorage.getItem('nani_language');
    if (saved) {
      const found = SUPPORTED_LANGUAGES.find((l) => l.code === saved);
      if (found) return found;
    }
    return SUPPORTED_LANGUAGES[0];
  });

  // Audio mute preference (persisted, default: false)
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    return localStorage.getItem('nani_muted') === 'true';
  });

  // Session ID
  const [sessionId] = useState<string>(() => {
    const existing = sessionStorage.getItem('nani_session_id');
    if (existing) return existing;
    const newId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem('nani_session_id', newId);
    return newId;
  });

  // Welcome message generator
  const getWelcomeMessage = (lang: SupportedLanguage): string => {
    if (lang.code.startsWith('hi')) {
      return 'नमस्ते! मैं नानी हूँ, आपकी लाइफलिंक स्वास्थ्य सहायक। मैं आपातकालीन एम्बुलेंस, अस्पताल के बेड और डॉक्टर की जानकारी में आपकी सहायता कर सकती हूँ। आज मैं आपकी क्या मदद करूँ?';
    }
    if (lang.code.startsWith('mr')) {
      return 'नमस्कार! मी नानी, तुमची लाइफलिंक आरोग्य सहाय्यक. मी रुग्णवाहिका, हॉस्पिटल बेड्स आणि डॉक्टरांच्या भेटीबाबत मदत करू शकते.';
    }
    return 'Namaste! I am Nani, your LifeLink healthcare coordinator. How can I help you with emergency ambulance dispatch, hospital beds, or navigating the platform today?';
  };

  // Conversation messages
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      sender: 'nani',
      text: getWelcomeMessage(selectedLang),
      timestamp: new Date(),
      provider: 'local_fallback',
    },
  ]);

  // SpeechSynthesis voices cache
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const speechRecognitionRef = useRef<any>(null);

  // Check browser SpeechRecognition availability
  const isSpeechRecognitionSupported =
    typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, loading, interimTranscript]);

  // Load conversation history on mount/open if available
  useEffect(() => {
    let isSubscribed = true;

    const loadHistory = async () => {
      try {
        const res = await apiFetch(`/chatbot/history?sessionId=${sessionId}`);
        if (isSubscribed && res && res.data && Array.isArray(res.data.messages) && res.data.messages.length > 0) {
          const loaded: ChatMessage[] = res.data.messages.map((m: any) => ({
            id: m.id || `hist_${Math.random()}`,
            sender: m.sender,
            text: m.text,
            timestamp: new Date(m.timestamp || Date.now()),
            provider: m.provider,
            isEmergency: m.isEmergency,
          }));
          setMessages(loaded);
          const hasEmergency = loaded.some((m) => m.isEmergency);
          if (hasEmergency) setIsEmergencyDetected(true);
        }
      } catch (err) {
        // Fall back gracefully to local default welcome message
        console.debug('No prior remote session history found or user is anonymous.');
      }
    };

    if (isOpen) {
      loadHistory();
    }

    return () => {
      isSubscribed = false;
    };
  }, [isOpen, sessionId]);

  // Load real backend model status on mount
  useEffect(() => {
    let isSubscribed = true;
    const fetchStatus = async () => {
      try {
        const res = await apiFetch('/chatbot/status');
        if (isSubscribed && res && res.data) {
          setModelStatus(res.data);
          if (res.data.provider) setAiProvider(res.data.provider);
        }
      } catch (err) {
        console.debug('Failed to query NANI model status:', err);
      }
    };
    fetchStatus();
    return () => {
      isSubscribed = false;
    };
  }, []);

  // Load and cache SpeechSynthesis voices
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      if (available && available.length > 0) {
        setVoices(available);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Listen for global lifelink:open-nani events
  useEffect(() => {
    const handleOpenNani = (e: Event) => {
      const customEvent = e as CustomEvent<{ prompt?: string }>;
      setIsOpen(true);
      if (customEvent.detail?.prompt) {
        setInputMessage(customEvent.detail.prompt);
      }
    };
    window.addEventListener('lifelink:open-nani', handleOpenNani);
    return () => {
      window.removeEventListener('lifelink:open-nani', handleOpenNani);
    };
  }, []);

  // Persist language selection
  useEffect(() => {
    localStorage.setItem('nani_language', selectedLang.code);
  }, [selectedLang]);

  // Persist mute state
  useEffect(() => {
    localStorage.setItem('nani_muted', String(isMuted));
    if (isMuted && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    }
  }, [isMuted]);

  // Stop speech when closing widget
  const handleClose = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.abort();
    }
    setIsSpeaking(false);
    setSpeakingMessageId(null);
    setIsListening(false);
    setMicState('idle');
    setIsOpen(false);
  };

  // Speak text using Web Speech API SpeechSynthesis
  const speakReply = (text: string, msgId?: string) => {
    if (isMuted || typeof window === 'undefined' || !window.speechSynthesis) {
      return;
    }

    try {
      window.speechSynthesis.cancel();

      // If user clicked the same message currently speaking, stop it
      if (msgId && speakingMessageId === msgId && isSpeaking) {
        setIsSpeaking(false);
        setSpeakingMessageId(null);
        return;
      }

      // Strip markdown asterisks or code formatting for natural voice output
      const sanitized = text
        .replace(/[*_#`~]/g, '')
        .replace(/\n+/g, ' ')
        .trim();

      if (!sanitized) return;

      const utterance = new SpeechSynthesisUtterance(sanitized);
      utterance.lang = selectedLang.bcp47;
      utterance.rate = 1.0;
      utterance.pitch = 1.05;

      const targetLang = selectedLang.bcp47.toLowerCase();
      const langPrefix = selectedLang.bcp47.split('-')[0].toLowerCase();

      const matchedVoice =
        voices.find((v) => v.lang.toLowerCase() === targetLang) ||
        voices.find((v) => v.lang.toLowerCase().replace('_', '-') === targetLang) ||
        voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));

      if (matchedVoice) {
        utterance.voice = matchedVoice;
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
        if (msgId) setSpeakingMessageId(msgId);
      };
      utterance.onend = () => {
        setIsSpeaking(false);
        setSpeakingMessageId(null);
      };
      utterance.onerror = (e) => {
        console.warn('SpeechSynthesis error:', e);
        setIsSpeaking(false);
        setSpeakingMessageId(null);
      };

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech output not supported or blocked by browser policy:', err);
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    }
  };

  // Stop speech playback
  const stopSpeech = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    }
  };

  // Send message to backend
  const handleSendMessage = async (textToSend?: string) => {
    const rawText = textToSend || inputMessage;
    if (!rawText.trim() || loading) return;

    // Stop current speech or voice recognition
    stopSpeech();
    if (speechRecognitionRef.current && isListening) {
      speechRecognitionRef.current.stop();
      setIsListening(false);
      setMicState('idle');
      setInterimTranscript('');
    }

    const userText = rawText.trim();
    if (!textToSend) {
      setInputMessage('');
    }
    setLastFailedMessage(null);

    // Add user message to UI
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      sender: 'user',
      text: userText,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const data = await apiFetch('/chatbot/message', {
        method: 'POST',
        body: JSON.stringify({
          message: userText,
          language: selectedLang.name,
          sessionId,
          allowExternalAi,
        }),
      });

      const replyText =
        (data && data.reply) ||
        'I am here to help you with LifeLink emergency services. Could you please rephrase your request?';

      if (data && data.isEmergency) {
        setIsEmergencyDetected(true);
      }
      if (data && data.provider) {
        setAiProvider(data.provider);
      }

      if (data?.toolExecution?.requiresUserConfirmation && data.toolExecution?.confirmationDetails) {
        setPendingConfirmation(data.toolExecution.confirmationDetails);
      } else {
        setPendingConfirmation(null);
      }

      const replyId = `reply_${Date.now()}`;
      const naniMsg: ChatMessage = {
        id: replyId,
        sender: 'nani',
        text: replyText,
        timestamp: new Date(),
        provider: data?.provider || 'local_fallback',
        isEmergency: data?.isEmergency || false,
        toolExecution: data?.toolExecution,
      };
      setMessages((prev) => [...prev, naniMsg]);

      // Voice output via Web Speech API
      speakReply(replyText, replyId);
    } catch (err: any) {
      console.error('Nani Chatbot Error:', err);
      setLastFailedMessage(userText);
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        sender: 'nani',
        text: 'I am experiencing connection difficulty with the health response network. Tap Retry below, or for acute emergencies use the LifeLink SOS button immediately.',
        timestamp: new Date(),
        failed: true,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  // Confirmation action handler for explicit user authorization
  const handleConfirmAction = async (details: any) => {
    if (!details || confirmationExecuting) return;
    setConfirmationExecuting(true);
    try {
      if (details.action === 'CONFIRM_EMERGENCY_DISPATCH') {
        handleTriggerEmergencySOS();
        const confMsg: ChatMessage = {
          id: `conf_${Date.now()}`,
          sender: 'nani',
          text: `🚨 Verified Dispatch Triggered: Emergency ambulance request created for ${details.pickupAddress || 'current patient location'}. Please keep your phone accessible.`,
          timestamp: new Date(),
          provider: 'system',
        };
        setMessages((prev) => [...prev, confMsg]);
        setPendingConfirmation(null);
      } else if (details.action === 'CONFIRM_APPOINTMENT_BOOKING') {
        const confMsg: ChatMessage = {
          id: `conf_${Date.now()}`,
          sender: 'nani',
          text: `✅ Verified OPD Appointment: Booking confirmed for slot ${details.slotId}. Your consultation queue token has been generated.`,
          timestamp: new Date(),
          provider: 'system',
        };
        setMessages((prev) => [...prev, confMsg]);
        setPendingConfirmation(null);
      }
    } catch (e) {
      console.error('Confirmation action failed:', e);
    } finally {
      setConfirmationExecuting(false);
    }
  };

  // Retry sending the last failed message
  const handleRetry = () => {
    if (lastFailedMessage) {
      handleSendMessage(lastFailedMessage);
    }
  };

  // Voice Input (Web Speech API SpeechRecognition)
  const toggleVoiceInput = async () => {
    setMicError(null);
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setMicState('unsupported');
      setMicError(
        'Voice recognition is not supported in this browser (e.g. Mozilla Firefox). You can type your message below, or use Google Chrome, Microsoft Edge, or Safari for voice interaction.'
      );
      return;
    }

    if (isListening && speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      setIsListening(false);
      setMicState('idle');
      setInterimTranscript('');
      return;
    }

    // Explicit permission pre-check if browser permissions API supports it
    if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
      try {
        const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (permissionStatus.state === 'denied') {
          setMicState('denied');
          setMicError(
            'Microphone access is blocked in your browser settings. Please allow microphone permissions in your browser address bar to speak with Nani. You can always type your message below.'
          );
          return;
        }
      } catch (err) {
        // Permissions query for 'microphone' is unsupported in some environments; proceed to recognition.start()
      }
    }

    try {
      setMicState('requesting');
      const recognition = new SpeechRecognition();
      recognition.lang = selectedLang.bcp47;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.continuous = false;

      recognition.onstart = () => {
        setIsListening(true);
        setMicState('listening');
        setInterimTranscript('');
        setMicError(null);
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }

        if (interim) {
          setInterimTranscript(interim);
        }

        if (final && final.trim()) {
          setInputMessage((prev) => (prev ? `${prev} ${final.trim()}` : final.trim()));
          setInterimTranscript('');
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error event:', event.error);
        setIsListening(false);
        setInterimTranscript('');

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setMicState('denied');
          setMicError(
            'Microphone access was denied. Please click the lock or settings icon in your address bar and allow microphone permissions to speak with Nani. You can continue typing below.'
          );
        } else if (event.error === 'no-speech') {
          setMicState('timeout');
          setMicError('No speech was detected before timeout. Tap the microphone again to retry, or type your message below.');
        } else if (event.error === 'network') {
          setMicState('network_error');
          setMicError('Speech recognition network error. Please check your internet connection or type your question below.');
        } else {
          setMicState('error');
          setMicError(`Voice recognition error (${event.error}). You can type your question directly below.`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        setMicState((prev) => (prev === 'listening' || prev === 'requesting' ? 'idle' : prev));
        setInterimTranscript('');
      };

      speechRecognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.error('Failed to initialize speech recognition:', err);
      setIsListening(false);
      setMicState('error');
      setMicError('Could not start microphone. Please verify device permissions and try again, or type your message below.');
    }
  };

  // Clear conversation history in accordance with privacy retention policy
  const handleClearHistory = async () => {
    stopSpeech();
    try {
      await apiFetch(`/chatbot/history?sessionId=${sessionId}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.debug('Error clearing backend conversation history:', err);
    }

    setIsEmergencyDetected(false);
    setLastFailedMessage(null);
    setMessages([
      {
        id: `welcome_${Date.now()}`,
        sender: 'nani',
        text: `Conversation history cleared. ${getWelcomeMessage(selectedLang)}`,
        timestamp: new Date(),
        provider: 'local_fallback',
      },
    ]);
  };

  // Direct action: Trigger Emergency SOS workflow
  const handleTriggerEmergencySOS = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('lifelink:open-sos'));
      if (!window.location.pathname.startsWith('/patient')) {
        window.location.href = '/patient?sos=open';
      }
    }
  };

  // Helper for provider badge text
  const getProviderLabel = () => {
    if (modelStatus?.rateLimited) {
      return `⏳ Groq 429 (${modelStatus.cooldownRemainingSec || 30}s)`;
    }
    if (aiProvider === 'groq' || modelStatus?.activeProvider === 'groq') {
      return `⚡ Groq: ${modelStatus?.model || 'gpt-oss-20b'} (Cloud)`;
    }
    if (modelStatus?.available && (aiProvider === 'ollama' || modelStatus.provider === 'ollama')) {
      return `🟢 ${modelStatus.model} (CPU ₹0)`;
    }
    if (aiProvider === 'gemini') return '⚡ Gemini 1.5 Flash (Cloud)';
    if (aiProvider === 'ollama') return '🖥️ Ollama Local (Connecting...)';
    return '🌱 Zero-Cost Local Guide (₹0)';
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end font-sans">
      {/* Expanded Chat Window */}
      {isOpen && (
        <div
          role="region"
          aria-label="Nani Healthcare Assistant Chat"
          className="mb-3 w-[94vw] sm:w-[400px] h-[560px] max-h-[85vh] bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-rose-600 via-rose-500 to-pink-600 p-3.5 text-white flex items-center justify-between shadow-md shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm border-2 border-white/40 flex items-center justify-center text-lg shadow-inner">
                  👵
                </div>
                {/* Speaking Wave Indicator */}
                {isSpeaking ? (
                  <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-400 border border-white flex items-center justify-center text-[8px]">
                      🔊
                    </span>
                  </span>
                ) : (
                  <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white shadow-sm" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-black text-sm tracking-tight">Nani</h3>
                  <button
                    type="button"
                    onClick={() => setShowPrivacyModal(true)}
                    className="px-1.5 py-0.5 rounded-full bg-white/20 hover:bg-white/30 text-[9px] font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer"
                    title="Click for AI provider, zero-cost, and privacy details"
                  >
                    {getProviderLabel()}
                  </button>
                </div>
                <p className="text-[10px] text-rose-100 font-medium">
                  {isSpeaking
                    ? 'Speaking response...'
                    : isListening
                    ? 'Listening to voice...'
                    : 'LifeLink Healthcare Assistant'}
                </p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1">
              {/* Language Selection Dropdown */}
              <div className="relative flex items-center bg-black/20 hover:bg-black/30 rounded-xl px-2 py-1 text-xs border border-white/20 transition-colors">
                <Languages className="w-3.5 h-3.5 mr-1 opacity-90" />
                <select
                  value={selectedLang.code}
                  onChange={(e) => {
                    const found = SUPPORTED_LANGUAGES.find((l) => l.code === e.target.value);
                    if (found) setSelectedLang(found);
                  }}
                  className="bg-transparent text-white font-semibold text-[11px] focus:outline-none cursor-pointer pr-1"
                  title="Select Conversation Language"
                  aria-label="Select conversation language"
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code} className="text-gray-900 bg-white">
                      {lang.nativeName} ({lang.name})
                    </option>
                  ))}
                </select>
              </div>

              {/* Mute / Unmute Audio Toggle */}
              <button
                type="button"
                onClick={() => setIsMuted(!isMuted)}
                className={`p-1.5 rounded-xl transition-colors cursor-pointer ${
                  isMuted
                    ? 'bg-black/30 text-rose-200 hover:bg-black/40'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
                title={isMuted ? 'Unmute voice replies' : 'Mute voice replies'}
                aria-label={isMuted ? 'Unmute audio replies' : 'Mute audio replies'}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              {/* Stop speech playback if speaking */}
              {isSpeaking && (
                <button
                  type="button"
                  onClick={stopSpeech}
                  className="p-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-900 transition-colors cursor-pointer"
                  title="Stop speaking"
                  aria-label="Stop speaking"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                </button>
              )}

              {/* Speech Capabilities & Limitations Info */}
              <button
                type="button"
                onClick={() => setShowSpeechInfoModal(true)}
                className="p-1.5 rounded-xl bg-black/20 hover:bg-black/30 text-white transition-colors cursor-pointer"
                title="Voice and Privacy Information"
                aria-label="Voice capabilities info"
              >
                <Info className="w-4 h-4" />
              </button>

              {/* Clear / Reset chat */}
              <button
                type="button"
                onClick={handleClearHistory}
                className="p-1.5 rounded-xl bg-black/20 hover:bg-black/30 text-white transition-colors cursor-pointer"
                title="Clear conversation history (Privacy-safe wipe)"
                aria-label="Clear chat history"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              {/* Close widget */}
              <button
                type="button"
                onClick={handleClose}
                className="p-1.5 rounded-xl bg-black/20 hover:bg-black/30 text-white transition-colors cursor-pointer"
                title="Close Nani"
                aria-label="Close Nani chat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Emergency 112 Red Alert Banner (Emergency Safety Guardrail) */}
          {isEmergencyDetected ? (
            <div className="bg-rose-600 text-white px-3.5 py-2.5 flex flex-col gap-1.5 shrink-0 border-b border-rose-700 animate-pulse">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-[11px] flex items-center gap-1.5 tracking-tight">
                  <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                  🚨 ACUTE EMERGENCY SYMPTOMS DETECTED
                </span>
                <button
                  type="button"
                  onClick={() => setIsEmergencyDetected(false)}
                  className="text-white/80 hover:text-white text-xs font-bold"
                  aria-label="Dismiss emergency banner"
                >
                  ✕
                </button>
              </div>
              <p className="text-[10px] leading-tight text-rose-100">
                Severe symptoms require immediate emergency care. Nani cannot diagnose or substitute clinical dispatch.
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <a
                  href="tel:112"
                  className="flex-1 bg-white hover:bg-rose-50 text-rose-700 font-extrabold text-[11px] py-1.5 px-3 rounded-lg text-center flex items-center justify-center gap-1 shadow-sm transition-all"
                  title="Call National Emergency 112"
                >
                  <PhoneCall className="w-3.5 h-3.5 text-rose-600" />
                  Call 112
                </a>
                <a
                  href="tel:108"
                  className="flex-1 bg-white/90 hover:bg-white text-rose-800 font-extrabold text-[11px] py-1.5 px-3 rounded-lg text-center flex items-center justify-center gap-1 shadow-sm transition-all"
                  title="Call Ambulance 108"
                >
                  <PhoneCall className="w-3.5 h-3.5 text-rose-600" />
                  Call 108
                </a>
                <button
                  type="button"
                  onClick={handleTriggerEmergencySOS}
                  className="flex-1 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-[11px] py-1.5 px-3 rounded-lg text-center flex items-center justify-center gap-1 shadow-sm transition-all cursor-pointer"
                  title="Launch LifeLink SOS"
                >
                  <ShieldAlert className="w-3.5 h-3.5 text-slate-950" />
                  Trigger SOS
                </button>
              </div>
              <span className="text-[9px] text-rose-200/90 italic mt-0.5">
                * Ambulances are not automatically dispatched from chat alone. Tap Trigger SOS to begin dispatch.
              </span>
            </div>
          ) : (
            /* Standard Safety Disclaimer Banner */
            <div className="bg-amber-500/10 border-b border-amber-500/20 px-3 py-1.5 flex items-center justify-between text-[11px] text-amber-700 dark:text-amber-300 shrink-0 font-medium">
              <div className="flex items-center gap-1.5 truncate">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="truncate">
                  For acute emergencies, immediately tap <strong className="font-extrabold text-rose-600 dark:text-rose-400">SOS</strong> or dial 112.
                </span>
              </div>
              <button
                type="button"
                onClick={handleTriggerEmergencySOS}
                className="text-[10px] font-extrabold text-rose-600 dark:text-rose-400 underline ml-2 shrink-0 cursor-pointer"
              >
                Open SOS
              </button>
            </div>
          )}

          {/* Microphone Permission Warning / Browser Error Banner */}
          {micError && (
            <div className="bg-amber-100 dark:bg-amber-950/80 border-b border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 px-3 py-2 text-[11px] flex items-start justify-between gap-2 shrink-0">
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span>{micError}</span>
              </div>
              <button
                type="button"
                onClick={() => setMicError(null)}
                className="font-bold text-xs opacity-75 hover:opacity-100 shrink-0 cursor-pointer"
                aria-label="Dismiss microphone notification"
              >
                ✕
              </button>
            </div>
          )}

          {/* Messages Scroll Area */}
          <div
            role="log"
            aria-live="polite"
            className="flex-1 p-3.5 overflow-y-auto space-y-3.5 bg-slate-50 dark:bg-slate-950 text-xs"
          >
            {messages.map((msg) => {
              const isUser = msg.sender === 'user';
              const isCurrentlySpeaking = speakingMessageId === msg.id && isSpeaking;

              return (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  {!isUser && (
                    <div className="w-8 h-8 rounded-full bg-rose-100 dark:bg-rose-950 border border-rose-200 dark:border-rose-900 flex items-center justify-center shrink-0 text-sm shadow-sm mt-0.5">
                      👵
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] p-3.5 rounded-2xl shadow-sm text-xs leading-relaxed whitespace-pre-wrap break-words ${
                      isUser
                        ? 'bg-rose-600 text-white rounded-tr-none shadow-rose-600/20'
                        : msg.isEmergency
                        ? 'bg-rose-50 dark:bg-rose-950/40 text-slate-900 dark:text-slate-100 border border-rose-300 dark:border-rose-800 rounded-tl-none'
                        : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-tl-none shadow-sm'
                    }`}
                  >
                    {/* Emergency message badge */}
                    {!isUser && msg.isEmergency && (
                      <div className="mb-2 flex items-center gap-1 text-[10px] font-black text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                        <AlertTriangle className="w-3 h-3 text-rose-600" />
                        Clinical Guardrail Notice
                      </div>
                    )}

                    {/* Verified tool result badge */}
                    {!isUser && msg.toolExecution && msg.toolExecution.success && (
                      <div className="mb-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                        <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                        <span>Verified Sourced Medical Data ({msg.toolExecution.tool})</span>
                      </div>
                    )}

                    <p className={`text-xs leading-relaxed ${isUser ? 'text-white font-medium' : 'text-slate-900 dark:text-slate-100 font-medium'}`}>
                      {msg.text}
                    </p>

                    {/* Emergency Call-to-Action within message */}
                    {!isUser && msg.isEmergency && (
                      <div className="mt-2.5 pt-2 border-t border-rose-200 dark:border-rose-800/60 flex flex-col sm:flex-row gap-1.5">
                        <button
                          type="button"
                          onClick={handleTriggerEmergencySOS}
                          className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-black text-[10px] py-1.5 px-2.5 rounded-lg flex items-center justify-center gap-1 shadow-sm transition-all cursor-pointer"
                        >
                          <ShieldAlert className="w-3 h-3" />
                          Launch LifeLink SOS (10s Window)
                        </button>
                        <a
                          href="tel:112"
                          className="bg-white dark:bg-slate-800 border border-rose-300 text-rose-700 dark:text-rose-300 font-extrabold text-[10px] py-1.5 px-2 rounded-lg flex items-center justify-center gap-1"
                        >
                          <PhoneCall className="w-3 h-3" />
                          112
                        </a>
                      </div>
                    )}

                    {/* Retry button on failed messages */}
                    {msg.failed && (
                      <div className="mt-2 pt-2 border-t border-rose-200 dark:border-rose-800 flex items-center justify-between">
                        <span className="text-[10px] text-rose-600 font-semibold">Delivery failed</span>
                        <button
                          type="button"
                          onClick={handleRetry}
                          className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-[10px] flex items-center gap-1 shadow-sm cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Retry
                        </button>
                      </div>
                    )}

                    {/* Metadata footer */}
                    <div className="flex items-center justify-between gap-2 mt-2 pt-1 text-[9px] font-mono text-slate-500 dark:text-slate-400">
                      <span>
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>

                      {!isUser && (
                        <div className="flex items-center gap-1.5">
                          {/* Play / Replay speech button for this message */}
                          <button
                            type="button"
                            onClick={() => speakReply(msg.text, msg.id)}
                            className={`p-1 rounded-md transition-colors cursor-pointer ${
                              isCurrentlySpeaking
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200'
                                : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500'
                            }`}
                            title={isCurrentlySpeaking ? 'Stop speaking this message' : 'Listen to this message'}
                            aria-label="Speak message"
                          >
                            {isCurrentlySpeaking ? <Square className="w-3 h-3 fill-current" /> : <Volume2 className="w-3 h-3" />}
                          </button>

                          <span className="opacity-75 uppercase text-[8px]">
                            {msg.provider === 'groq'
                              ? '⚡ Groq LPU'
                              : msg.provider === 'gemini'
                              ? 'Gemini'
                              : msg.provider === 'ollama'
                              ? '🟢 Ollama'
                              : msg.provider === 'emergency_guardrail'
                              ? '🚨 Safety Guard'
                              : msg.provider === 'local_model'
                              ? 'Local LLM'
                              : 'Local'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Listening Live Transcript Banner */}
            {isListening && (
              <div className="flex items-center justify-between gap-2 p-2.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-300 text-xs animate-pulse">
                <div className="flex items-center gap-2 truncate">
                  <span className="relative flex h-3 w-3 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600" />
                  </span>
                  <div className="truncate">
                    <span className="font-bold">Listening in {selectedLang.nativeName}...</span>{' '}
                    <span className="italic opacity-90">{interimTranscript || 'Speak your question now'}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (speechRecognitionRef.current) speechRecognitionRef.current.stop();
                    setIsListening(false);
                    setMicState('idle');
                    setInterimTranscript('');
                  }}
                  className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-[10px] shrink-0 cursor-pointer"
                >
                  Done
                </button>
              </div>
            )}

            {/* Typing / Thinking Indicator */}
            {loading && (
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-rose-100 dark:bg-rose-950 border border-rose-200 dark:border-rose-900 flex items-center justify-center shrink-0 text-sm shadow-sm">
                  👵
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-2xl rounded-tl-none flex items-center gap-1.5 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-bounce" />
                  <span className="text-xs text-slate-700 dark:text-slate-200 ml-1.5 font-semibold">
                    Nani is formulating guidance...
                  </span>
                </div>
              </div>
            )}

            {/* Pending Tool Action Confirmation Card (Human-in-the-Loop) */}
            {pendingConfirmation && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/50 border-2 border-amber-400 dark:border-amber-600 rounded-2xl shadow-md text-xs animate-in fade-in">
                <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-extrabold mb-1">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Action Confirmation Required</span>
                </div>
                <p className="text-slate-800 dark:text-slate-200 font-medium mb-2.5">
                  {pendingConfirmation.action === 'CONFIRM_EMERGENCY_DISPATCH'
                    ? `Dispatch emergency ambulance to "${pendingConfirmation.pickupAddress || 'your location'}"?`
                    : pendingConfirmation.action === 'CONFIRM_APPOINTMENT_BOOKING'
                    ? `Confirm appointment booking for doctor consultation (Slot: ${pendingConfirmation.slotId})?`
                    : 'Confirm this action?'}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={confirmationExecuting}
                    onClick={() => handleConfirmAction(pendingConfirmation)}
                    className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold rounded-xl text-center shadow-sm cursor-pointer transition-colors text-xs"
                  >
                    {confirmationExecuting ? 'Confirming...' : 'Yes, Confirm'}
                  </button>
                  <button
                    type="button"
                    disabled={confirmationExecuting}
                    onClick={() => setPendingConfirmation(null)}
                    className="py-1.5 px-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 font-bold rounded-xl cursor-pointer transition-colors text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Message Input & Send Bar (Always accessible for typing) */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 shrink-0"
          >
            {/* Speech-to-Text Microphone Button */}
            <button
              type="button"
              onClick={toggleVoiceInput}
              className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                isListening
                  ? 'bg-rose-600 text-white border-rose-600 animate-pulse ring-2 ring-rose-400'
                  : isSpeechRecognitionSupported
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-800 opacity-60'
              }`}
              title={
                !isSpeechRecognitionSupported
                  ? 'Speech recognition not supported in this browser'
                  : isListening
                  ? 'Listening... Click to stop'
                  : `Voice input in ${selectedLang.name}`
              }
              aria-label="Toggle voice input"
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            {/* Input is always accessible for typing even if mic fails or is disabled */}
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder={`Ask Nani in ${selectedLang.nativeName}...`}
              className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 px-3.5 py-2.5 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-rose-500 transition-colors font-medium"
              aria-label="Type message for Nani"
            />

            <button
              type="submit"
              disabled={!inputMessage.trim() || loading}
              className="p-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white rounded-xl transition-all shadow-md shadow-rose-600/20 cursor-pointer disabled:cursor-not-allowed"
              title="Send message"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      {/* Collapsed State: Floating Button */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="group relative flex items-center gap-2 p-3.5 bg-gradient-to-tr from-rose-700 via-rose-600 to-pink-500 text-white rounded-full shadow-2xl hover:shadow-rose-600/40 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer border-2 border-white/20"
          aria-label="Open Nani AI Assistant"
        >
          {/* Subtle Ambient Pulse Ring */}
          <span className="absolute -inset-1 rounded-full bg-rose-500/30 animate-ping pointer-events-none opacity-60" />

          {/* Avatar Icon */}
          <span className="text-2xl leading-none">👵</span>

          {/* Friendly Label on Hover or Mobile */}
          <span className="max-w-0 overflow-hidden whitespace-nowrap group-hover:max-w-xs transition-all duration-300 ease-in-out text-xs font-bold tracking-wide pr-1">
            Talk to Nani
          </span>

          {/* Speaking Audio Badge if active in background */}
          {isSpeaking && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-white animate-pulse" />
          )}
        </button>
      )}

      {/* Modal 1: Privacy, AI Provider & Zero-Cost Architecture */}
      {showPrivacyModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-5 shadow-2xl text-slate-800 dark:text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <h4 className="font-extrabold text-sm">Privacy & Zero-Cost Architecture</h4>
              </div>
              <button
                type="button"
                onClick={() => setShowPrivacyModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs leading-relaxed">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
                <span className="font-bold text-slate-900 dark:text-white block mb-1">
                  Active Model: {getProviderLabel()}
                </span>
                <p className="text-slate-600 dark:text-slate-300">
                  {aiProvider === 'groq'
                    ? 'Connected to Groq Cloud LPU acceleration (openai/gpt-oss-20b or llama-3.3-70b-versatile). Ultra-low latency responses with pre-transmission PII redaction.'
                    : aiProvider === 'gemini'
                    ? 'Connected to Google Gemini 1.5 Flash cloud adapter. All phone numbers, emails, and credentials are automatically scrubbed before transmission.'
                    : aiProvider === 'ollama'
                    ? 'Connected to local Ollama daemon (qwen3:4b) running directly on private AMD Ryzen CPU. ₹0 API fees, 100% on-device.'
                    : 'Operating in 100% Zero-Cost Local Heuristic Mode. Domain safety rules execute on-device with zero remote model fees or telemetry.'}
                </p>
              </div>

              {/* External Cloud AI Consent Toggle */}
              <div className="p-3 bg-rose-50/60 dark:bg-rose-950/40 rounded-xl border border-rose-200 dark:border-rose-900 flex items-start justify-between gap-3">
                <div className="flex-1">
                  <span className="font-extrabold text-slate-900 dark:text-white block text-xs">
                    Allow External Cloud AI (Groq LPUs)
                  </span>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-snug">
                    Enables high-speed cloud inference via Groq LPUs for sub-second responses. Patient phone numbers, names, and identifiers are strictly scrubbed before transmission.
                  </p>
                  <span className="text-[10px] text-rose-700 dark:text-rose-400 font-semibold block mt-1">
                    {allowExternalAi ? '✓ Consent granted: Groq cloud eligible.' : '✗ Disabled: 100% private local Ollama / offline rules only.'}
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                  <input
                    type="checkbox"
                    checked={allowExternalAi}
                    onChange={(e) => handleToggleExternalAi(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-rose-600"></div>
                </label>
              </div>

              <div>
                <span className="font-bold block mb-0.5">India DPDP 2023 Compliance & PII Scrubbing</span>
                <p className="text-slate-600 dark:text-slate-300">
                  Phone numbers, emails, passwords, tokens, and Aadhaar identifiers are scrubbed before any remote model processing.
                </p>
              </div>

              <div>
                <span className="font-bold block mb-0.5">Audio Privacy & Zero Voice Retention</span>
                <p className="text-slate-600 dark:text-slate-300">
                  LifeLink does NOT record, stream, or retain user microphone audio on any server. Voice recognition executes strictly client-side via the browser’s Web Speech API.
                </p>
              </div>

              <div>
                <span className="font-bold block mb-0.5">Ephemeral Memory & 2-Hour TTL</span>
                <p className="text-slate-600 dark:text-slate-300">
                  Conversations reside strictly in server volatile memory for up to 2 hours. Tap the Reset (🔄) button at any time to immediately wipe all stored context.
                </p>
              </div>

              <div>
                <span className="font-bold block mb-0.5">Emergency & 112 Clarification</span>
                <p className="text-slate-600 dark:text-slate-300">
                  LifeLink provides direct 112 dialing assistance and does not claim an official government dispatch integration. Ambulances are not automatically dispatched based on chat alone.
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowPrivacyModal(false)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Speech Capabilities & Limitations */}
      {showSpeechInfoModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-5 shadow-2xl text-slate-800 dark:text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Volume2 className="w-5 h-5 text-rose-600" />
                <h4 className="font-extrabold text-sm">Speech Engine Capabilities & Limits</h4>
              </div>
              <button
                type="button"
                onClick={() => setShowSpeechInfoModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs leading-relaxed">
              <div>
                <span className="font-bold block mb-0.5">Speech Recognition (Speech-to-Text)</span>
                <p className="text-slate-600 dark:text-slate-300">
                  Supported natively on Google Chrome, Microsoft Edge, and Safari using the browser’s Web Speech API. Firefox does not currently support SpeechRecognition by default.
                </p>
              </div>

              <div>
                <span className="font-bold block mb-0.5">Microphone Permissions & HTTPS</span>
                <p className="text-slate-600 dark:text-slate-300">
                  Browsers require explicit user consent and a secure origin (HTTPS or localhost) before microphone recording can begin.
                </p>
              </div>

              <div>
                <span className="font-bold block mb-0.5">Synthetic Voice Output (Text-to-Speech)</span>
                <p className="text-slate-600 dark:text-slate-300">
                  Audio synthesis runs 100% on-device using your operating system’s installed synthetic voice packages with zero network data consumption.
                </p>
              </div>

              <div>
                <span className="font-bold block mb-0.5">Emergency Audio Disclaimer</span>
                <p className="text-slate-600 dark:text-slate-300">
                  In acute emergency situations, immediately dial 112 directly. Do not wait for synthetic audio speech playback to finish.
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowSpeechInfoModal(false)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NaniChat;
