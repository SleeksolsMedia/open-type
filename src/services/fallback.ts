import {requireBaseUrl} from '../net';
import {isModelDownloaded} from '../providers/models';
import type {SttConfig} from '../types';

/**
 * Can the HTTP upload pipeline run at all with this config?
 * Guards the live→upload fallback so a missing Base URL (or no downloaded
 * on-device model) surfaces the ORIGINAL live error instead of a
 * misleading "base URL missing".
 */
export async function isUploadUsable(stt: SttConfig): Promise<boolean> {
  try {
    if (stt.kind === 'on-device') {
      return await isModelDownloaded(stt.onDeviceModelId || 'tiny.en');
    }
    requireBaseUrl(stt.baseUrl);
    return true;
  } catch {
    return false;
  }
}
