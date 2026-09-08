import {DeepgramDriver, type DeepgramConfig} from './deepgram';
import {OpenAiLiveDriver, type OpenAiLiveConfig} from './openaiLive';
import {WhisperLiveDriver, type WhisperLiveConfig} from './whisperLive';
import type {LiveConfig, StreamDriver} from '../types';

export function createDriver(cfg: LiveConfig): StreamDriver {
  switch (cfg.provider) {
    case 'deepgram': {
      const dc: DeepgramConfig = {
        apiKey: cfg.apiKey ?? '',
        model: cfg.model,
        language: cfg.language,
      };
      return new DeepgramDriver(dc);
    }
    case 'whisper-live': {
      const wc: WhisperLiveConfig = {
        serverUrl: cfg.serverUrl,
        host: cfg.host,
        port: cfg.port,
        tls: cfg.tls,
        apiKey: cfg.apiKey,
      };
      return new WhisperLiveDriver(wc);
    }
    case 'openai-live':
    default: {
      const oc: OpenAiLiveConfig = {
        apiKey: cfg.apiKey ?? '',
        model: cfg.model,
        language: cfg.language,
      };
      return new OpenAiLiveDriver(oc);
    }
  }
}
