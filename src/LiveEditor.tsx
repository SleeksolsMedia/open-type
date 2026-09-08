import React, {useEffect, useRef, useState} from 'react';
import {Switch, Text, View} from 'react-native';
import {createDriver} from './stream/drivers';
import {buildWhisperLiveUrl} from './stream/drivers/whisperLive';
import {LIVE_PROVIDERS, type LiveConfig} from './stream/types';
import {Banner, Btn, Field, Row} from './ui';
import {PresetGrid} from './ProviderSetup';
import {fonts, useTheme} from './theme';

type TestState =
  | {kind: 'idle'}
  | {kind: 'working'}
  | {kind: 'ok'}
  | {kind: 'error'; message: string};

/**
 * Live (WebSocket) STT setup: provider → key/host → Test handshake.
 * No custom-protocol option by design: each socket protocol is bespoke.
 */
export function LiveEditor({
  live,
  onChange,
  onVerifiedChange,
}: {
  live: LiveConfig;
  onChange: (l: LiveConfig) => void;
  onVerifiedChange?: (ok: boolean) => void;
}): React.JSX.Element {
  const t = useTheme();
  const [test, setTest] = useState<TestState>({kind: 'idle'});
  const [lines, setLines] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);

  const signature = JSON.stringify([
    live.provider,
    live.apiKey,
    live.serverUrl,
    live.host,
    live.port,
    live.tls,
    live.model,
    live.language,
  ]);

  useEffect(() => {
    setTest({kind: 'idle'});
    onVerifiedChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    return () => abort.current?.abort();
  }, []);

  const set = (patch: Partial<LiveConfig>) => onChange({...live, ...patch});

  const pushLine = (line: string) => {
    const stamp = new Date().toLocaleTimeString();
    setLines(prev => [...prev.slice(-7), `${stamp}  ${line}`]);
  };

  const describeTarget = (): string => {
    if (live.provider === 'whisper-live') {
      try {
        return buildWhisperLiveUrl({
          serverUrl: live.serverUrl,
          host: live.host,
          port: live.port,
          tls: live.tls,
        });
      } catch {
        return (live.serverUrl ?? live.host ?? '').trim() || '(no address yet)';
      }
    }
    return live.provider === 'deepgram'
      ? 'wss://api.deepgram.com/v1/listen'
      : 'wss://api.openai.com/v1/realtime';
  };

  const runTest = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setLines([]);
    setTest({kind: 'working'});
    pushLine(`→ Connecting to ${describeTarget()} …`);
    if (live.provider === 'whisper-live') {
      pushLine('→ Sending handshake (transcribe, int16 audio) …');
    } else {
      pushLine('→ Opening socket, sending session config …');
    }
    pushLine('→ Waiting for server ready …');
    try {
      await createDriver({...live}).test(ctrl.signal);
      pushLine('✓ Server ready — handshake complete.');
      setTest({kind: 'ok'});
      onVerifiedChange?.(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'Cancelled.') {
        pushLine(`✗ ${msg}`);
        setTest({kind: 'error', message: msg});
      } else {
        pushLine('— Cancelled.');
        setTest({kind: 'idle'});
      }
    }
  };

  return (
    <View>
      <Banner
        kind="info"
        text="Live mode streams audio as you speak for lower latency. The finished recording is always kept, so the upload fallback never needs a re-record."
      />
      <PresetGrid
        items={LIVE_PROVIDERS}
        value={live.provider}
        onPick={p => set({provider: p.id as LiveConfig['provider']})}
      />
      {live.provider === 'whisper-live' ? (
        <View>
          <Field
            title="Server address"
            value={live.serverUrl ?? live.host ?? ''}
            onChange={v => set({serverUrl: v})}
            placeholder="wss://voice.example.com/live  or  192.168.1.10:9090"
            keyboardType="url"
          />
          <Text style={{color: t.subtext, fontSize: 12, marginBottom: 4}}>
            Full WebSocket URL, host:port, or bare host (defaults to port
            9090). The ws:// / wss:// prefix decides encryption.
          </Text>
          <Field
            title="API key (only if your server needs one)"
            value={live.apiKey ?? ''}
            onChange={v => set({apiKey: v})}
            secret
            placeholder="leave empty for open servers"
          />
        </View>
      ) : (
        <View>
          <Field
            title="API key"
            value={live.apiKey ?? ''}
            onChange={v => set({apiKey: v})}
            secret
            placeholder={live.provider === 'deepgram' ? 'Deepgram key' : 'sk-…'}
          />
          <Field
            title="Model"
            value={live.model ?? ''}
            onChange={v => set({model: v})}
            placeholder={
              live.provider === 'deepgram' ? 'nova-3' : 'gpt-4o-mini-transcribe'
            }
          />
          <Field
            title="Language (empty = auto-detect)"
            value={live.language ?? ''}
            onChange={v => set({language: v})}
            placeholder="en"
          />
        </View>
      )}

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginVertical: 6,
        }}>
        <Text style={{color: t.text, fontFamily: fonts.bodySemiBold, flex: 1, paddingRight: 8}}>
          If live fails, upload the recording instead
        </Text>
        <Switch
          value={live.fallbackToUpload}
          onValueChange={v => set({fallbackToUpload: v})}
        />
      </View>

      {test.kind === 'working' && (
        <Row>
          <Btn
            title="Testing… (tap to cancel)"
            kind="ghost"
            onPress={() => abort.current?.abort()}
          />
        </Row>
      )}
      {test.kind === 'ok' && (
        <Banner kind="ok" text="✓ Live handshake works — ready to stream." />
      )}
      {test.kind === 'error' && <Banner kind="err" text={test.message} />}
      {lines.length > 0 && (
        <View
          style={{
            backgroundColor: t.dark ? '#0B0E13' : '#F1F3F6',
            borderRadius: 8,
            padding: 10,
            marginTop: 8,
          }}>
          {lines.map((l, i) => (
            <Text
              key={i}
              selectable
              style={{color: t.subtext, fontSize: 12, fontFamily: fonts.mono, marginBottom: 2}}>
              {l}
            </Text>
          ))}
        </View>
      )}
      {test.kind !== 'working' && (
        <Row>
          <Btn title="Test live connection" onPress={runTest} />
        </Row>
      )}
    </View>
  );
}
