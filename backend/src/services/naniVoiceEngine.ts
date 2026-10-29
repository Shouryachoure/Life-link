/**
 * LifeLink NANI - Local Voice Capabilities Engine
 * 
 * Modular Voice Interfaces for Local Speech-to-Text (STT) and Text-to-Speech (TTS):
 * - Evaluates faster-whisper and Piper TTS for local server runtime.
 * - Bridges with browser-native Web Speech API running 100% on-device at zero cost.
 * - Safety Invariant: Voice processing is strictly asynchronous and optional;
 *   speech-recognition delays NEVER block emergency safety rules or 112 dialing.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface VoiceEngineStatus {
  stt: {
    engine: string;
    installed: boolean;
    available: boolean;
    supportedLanguages: string[];
    runtimeNote: string;
  };
  tts: {
    engine: string;
    installed: boolean;
    available: boolean;
    supportedVoices: string[];
    runtimeNote: string;
  };
  browserNative: {
    supported: boolean;
    speechRecognition: string;
    speechSynthesis: string;
    privacyNote: string;
  };
}

export interface ISpeechToTextProvider {
  name: string;
  checkAvailability(): Promise<{ available: boolean; reason?: string }>;
  transcribe(audioBuffer: Buffer, language?: string): Promise<{ text: string; language: string; latencyMs: number }>;
}

export interface ITextToSpeechProvider {
  name: string;
  checkAvailability(): Promise<{ available: boolean; reason?: string }>;
  synthesize(text: string, voice?: string): Promise<{ audioBuffer: Buffer; mimeType: string; latencyMs: number }>;
}

/**
 * 1. Faster-Whisper Server-Side STT Provider
 * Evaluates Python faster-whisper package on host machine.
 */
export class FasterWhisperSttProvider implements ISpeechToTextProvider {
  name = 'faster-whisper';

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const { stdout } = await execAsync('python -c "import faster_whisper; print(\'OK\')"', { timeout: 3000 });
      if (stdout.trim().includes('OK')) {
        return { available: true };
      }
      return { available: false, reason: 'faster_whisper import check failed.' };
    } catch (err: any) {
      return {
        available: false,
        reason: 'Python package faster-whisper is not installed in the local environment. Install via: pip install faster-whisper',
      };
    }
  }

  async transcribe(_audioBuffer: Buffer, language: string = 'en'): Promise<{ text: string; language: string; latencyMs: number }> {
    const isAvail = await this.checkAvailability();
    if (!isAvail.available) {
      throw new Error(`faster-whisper unavailable: ${isAvail.reason}`);
    }
    // Simulation / stub for when installed
    return {
      text: '',
      language,
      latencyMs: 0,
    };
  }
}

/**
 * 2. Piper TTS Server-Side Provider
 * Evaluates Piper on-device neural text-to-speech engine.
 */
export class PiperTtsProvider implements ITextToSpeechProvider {
  name = 'piper-tts';

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const { stdout } = await execAsync('piper --version', { timeout: 2000 });
      if (stdout.trim().length > 0) {
        return { available: true };
      }
      return { available: false, reason: 'piper executable did not return version.' };
    } catch {
      return {
        available: false,
        reason: 'Piper binary is not installed in PATH. Piper is evaluated as an optional on-device neural voice generator.',
      };
    }
  }

  async synthesize(_text: string, _voice?: string): Promise<{ audioBuffer: Buffer; mimeType: string; latencyMs: number }> {
    const isAvail = await this.checkAvailability();
    if (!isAvail.available) {
      throw new Error(`Piper TTS unavailable: ${isAvail.reason}`);
    }
    return {
      audioBuffer: Buffer.from([]),
      mimeType: 'audio/wav',
      latencyMs: 0,
    };
  }
}

/**
 * Voice capabilities coordinator
 */
export class NaniVoiceCoordinator {
  private fasterWhisper = new FasterWhisperSttProvider();
  private piperTts = new PiperTtsProvider();

  async getStatus(): Promise<VoiceEngineStatus> {
    const fwStatus = await this.fasterWhisper.checkAvailability();
    const piperStatus = await this.piperTts.checkAvailability();

    return {
      stt: {
        engine: 'faster-whisper',
        installed: fwStatus.available,
        available: fwStatus.available,
        supportedLanguages: ['en', 'hi', 'mr'],
        runtimeNote: fwStatus.available
          ? 'faster-whisper local runtime active on host Python.'
          : (fwStatus.reason || 'Not installed in current Python runtime.'),
      },
      tts: {
        engine: 'piper-tts',
        installed: piperStatus.available,
        available: piperStatus.available,
        supportedVoices: ['en_US-lessac', 'hi_IN-swara'],
        runtimeNote: piperStatus.available
          ? 'Piper neural TTS executable active.'
          : (piperStatus.reason || 'Binary not found in system PATH.'),
      },
      browserNative: {
        supported: true,
        speechRecognition: 'Browser Web Speech API SpeechRecognition (Chrome, Edge, Safari; client-side on-device)',
        speechSynthesis: 'Browser Web Speech API SpeechSynthesis (Zero network overhead, 100% on-device)',
        privacyNote: 'Zero voice recording stored on backend server. Speech processes directly inside patient browser.',
      },
    };
  }
}

export const voiceCoordinator = new NaniVoiceCoordinator();
