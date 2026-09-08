import {isUploadUsable} from '../src/services/fallback';
import {DEFAULT_SETTINGS} from '../src/types';

test('cloud upload usable with a base URL', async () => {
  await expect(
    isUploadUsable({...DEFAULT_SETTINGS.stt, baseUrl: 'https://x/v1'}),
  ).resolves.toBe(true);
});

test('cloud upload unusable without a base URL', async () => {
  await expect(
    isUploadUsable({...DEFAULT_SETTINGS.stt, baseUrl: ''}),
  ).resolves.toBe(false);
});

test('on-device upload unusable without a downloaded model', async () => {
  await expect(
    isUploadUsable({
      ...DEFAULT_SETTINGS.stt,
      kind: 'on-device',
      onDeviceModelId: 'tiny.en',
    }),
  ).resolves.toBe(false);
});
