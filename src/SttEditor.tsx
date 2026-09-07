import React, {useEffect, useRef, useState} from 'react';
import {Switch, Text, View} from 'react-native';
import {ModelList} from './ModelRow';
import {
  KindToggle,
  ModelPicker,
  PresetGrid,
  ResolvedPreview,
} from './ProviderSetup';
import {isModelsUnsupported, listModels} from './net';
import {isModelDownloaded} from './providers/models';
import {STT_PRESETS, type SttConfig} from './types';
import {Banner, Btn, Field, Row} from './ui';
import {useTheme} from './theme';
import {testStt} from './testConnection';

type Conn =
  | {kind: 'idle'}
  | {kind: 'working'}
  | {kind: 'live'; models: string[]}
  | {kind: 'manual'}
  | {kind: 'manual-ok'}
  | {kind: 'error'; message: string};

/**
 * Staged STT setup: provider + key → Test connection (live model list) →
 * pick a model from the dropdown. Falls back to a manual model field when
 * the server has no /v1/models endpoint.
 */
export function SttEditor({
  stt,
  onChange,
  onVerifiedChange,
}: {
  stt: SttConfig;
  onChange: (s: SttConfig) => void;
  onVerifiedChange?: (ok: boolean) => void;
}): React.JSX.Element {
  const t = useTheme();
  const [conn, setConn] = useState<Conn>({kind: 'idle'});
  const [keyRequired, setKeyRequired] = useState(true);
  const [sample, setSample] = useState<string | null>(null);
  const [sampling, setSampling] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // Server identity: any change here invalidates the connection test.
  const signature = JSON.stringify([
    stt.kind,
    stt.preset,
    stt.baseUrl,
    stt.apiKey,
    stt.language,
    keyRequired,
  ]);

  useEffect(() => {
    setConn({kind: 'idle'});
    setSample(null);
    onVerifiedChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    return () => abort.current?.abort();
  }, []);

  const verifyOnDevice = async (id: string): Promise<void> => {
    const ok = await isModelDownloaded(id).catch(() => false);
    onVerifiedChange?.(ok);
  };

  // Re-verify a previously downloaded model when returning to this screen.
  useEffect(() => {
    if (stt.kind === 'on-device') {
      verifyOnDevice(stt.onDeviceModelId || 'tiny.en');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch: Partial<SttConfig>) => onChange({...stt, ...patch});

  const applyPreset = (id: SttConfig['preset']) => {
    const p = STT_PRESETS.find(x => x.id === id);
    if (!p) {
      return;
    }
    setKeyRequired(p.needsKey);
    set({preset: id, baseUrl: p.baseUrl, model: p.model});
  };

  const runConnectionTest = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setConn({kind: 'working'});
    try {
      const models = await listModels(stt.baseUrl, stt.apiKey, {
        signal: ctrl.signal,
      });
      const current = (stt.model ?? '').trim();
      const pick =
        current && models.includes(current) ? current : models[0];
      set({model: pick});
      setConn({kind: 'live', models});
      onVerifiedChange?.(true);
    } catch (e) {
      if (isModelsUnsupported(e)) {
        setConn({kind: 'manual'});
        onVerifiedChange?.(false);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg !== 'Cancelled.') {
          setConn({kind: 'error', message: msg});
        } else {
          setConn({kind: 'idle'});
        }
      }
    }
  };

  const runSample = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setSampling(true);
    setSample(null);
    try {
      const text = await testStt(
        stt,
        () => undefined,
        ctrl.signal,
      );
      setSample(`Heard: "${text}"`);
      if (conn.kind === 'manual') {
        setConn({kind: 'manual-ok'});
        onVerifiedChange?.(true);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'Cancelled.') {
        setSample(`Transcription test failed: ${msg}`);
      }
    } finally {
      setSampling(false);
    }
  };

  const showKey =
    stt.kind === 'openai-compatible' &&
    (stt.preset !== 'custom'
      ? (STT_PRESETS.find(p => p.id === stt.preset)?.needsKey ?? true)
      : keyRequired);

  return (
    <View>
      <KindToggle
        options={[
          {id: 'openai-compatible', label: 'Cloud / self-hosted', icon: 'cloud'},
          {id: 'on-device', label: 'On-device', icon: 'cellphone'},
        ]}
        value={stt.kind}
        onChange={id => {
          if (id === 'on-device') {
            set({kind: 'on-device'});
            verifyOnDevice(stt.onDeviceModelId || 'tiny.en');
          } else {
            set({kind: 'openai-compatible'});
          }
        }}
      />

      {stt.kind === 'openai-compatible' ? (
        <View>
          <PresetGrid
            items={STT_PRESETS}
            value={stt.preset}
            onPick={p => applyPreset(p.id as SttConfig['preset'])}
          />
          <Field
            title="Base URL"
            value={stt.baseUrl ?? ''}
            onChange={v => set({baseUrl: v, preset: 'custom'})}
            placeholder="https://api.openai.com/v1"
            keyboardType="url"
          />
          <ResolvedPreview
            method="Calls: POST"
            baseUrl={stt.baseUrl ?? ''}
            suffix="/audio/transcriptions"
          />
          <Field
            title="Language (empty = auto-detect)"
            value={stt.language ?? ''}
            onChange={v => set({language: v})}
            placeholder="en"
          />
          {stt.preset === 'custom' && (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginVertical: 6,
              }}>
              <Text style={{color: t.text}}>Server needs an API key</Text>
              <Switch value={keyRequired} onValueChange={setKeyRequired} />
            </View>
          )}
          {showKey && (
            <Field
              title="API key"
              value={stt.apiKey ?? ''}
              onChange={v => set({apiKey: v})}
              secret
              placeholder="sk-…"
            />
          )}

          {conn.kind === 'idle' && (
            <Row>
              <Btn title="Test connection" icon="lan-connect" onPress={runConnectionTest} />
            </Row>
          )}
          {conn.kind === 'working' && (
            <Row>
              <Btn
                title="Testing… (tap to cancel)"
                icon="close"
                kind="ghost"
                onPress={() => abort.current?.abort()}
              />
            </Row>
          )}
          {conn.kind === 'error' && (
            <View>
              <Banner kind="err" text={conn.message} />
              <Row>
                <Btn title="Retry test" icon="refresh" onPress={runConnectionTest} />
              </Row>
            </View>
          )}
          {conn.kind === 'live' && (
            <View>
              <Banner
                kind="ok"
                text="Connected — model list loaded from your provider."
              />
              <ModelPicker
                models={conn.models}
                value={stt.model ?? ''}
                onChange={m => set({model: m})}
              />
              <Row>
                <Btn
                  title="Test transcription (3s)"
                  icon="microphone"
                  kind="ghost"
                  onPress={runSample}
                />
              </Row>
            </View>
          )}
          {(conn.kind === 'manual' || conn.kind === 'manual-ok') && (
            <View>
              <Banner
                kind="info"
                text="This server has no model list endpoint — enter the model name manually, then run the transcription test."
              />
              <Field
                title="Model"
                value={stt.model ?? ''}
                onChange={v => {
                  set({model: v});
                  if (conn.kind === 'manual-ok') {
                    setConn({kind: 'manual'});
                    onVerifiedChange?.(false);
                  }
                }}
                placeholder="whisper-1"
              />
              {conn.kind === 'manual-ok' && (
                <Banner kind="ok" text="Transcription works with this model." />
              )}
              <Row>
                <Btn
                  title="Test transcription (3s)"
                  icon="microphone"
                  onPress={runSample}
                />
              </Row>
            </View>
          )}
          {sampling && <Banner kind="info" text="Recording 3s sample… speak now." />}
          {!!sample && !sampling && (
            <Banner
              kind={sample.startsWith('Heard:') ? 'ok' : 'err'}
              text={sample}
            />
          )}
        </View>
      ) : (
        <OnDeviceSection
          modelId={stt.onDeviceModelId || 'tiny.en'}
          onSelect={id => {
            set({onDeviceModelId: id});
            verifyOnDevice(id);
          }}
        />
      )}
    </View>
  );
}

function OnDeviceSection({
  modelId,
  onSelect,
}: {
  modelId: string;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <View>
      <Banner
        kind="info"
        text="Fully offline transcription on your phone. Download a model once — no audio ever leaves the device."
      />
      <ModelList selectedId={modelId} onSelect={onSelect} />
    </View>
  );
}
