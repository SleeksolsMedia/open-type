import React, {useEffect, useRef, useState} from 'react';
import {Switch, Text, View} from 'react-native';
import {
  ModelPicker,
  PresetGrid,
  ResolvedPreview,
} from './ProviderSetup';
import {isModelsUnsupported, listModels} from './net';
import {testLlm} from './testConnection';
import {LLM_PRESETS, type LlmConfig} from './types';
import {Banner, Btn, Field, Row} from './ui';
import {useTheme} from './theme';

type Conn =
  | {kind: 'idle'}
  | {kind: 'working'}
  | {kind: 'live'; models: string[]}
  | {kind: 'manual'}
  | {kind: 'manual-ok'}
  | {kind: 'error'; message: string};

/**
 * Staged LLM setup: provider + key → Test connection (live model list) →
 * pick a model → system prompt. The prompt appears only after a model is
 * locked in. Reports verified when disabled (skip) or connected.
 */
export function LlmEditor({
  llm,
  onChange,
  onVerifiedChange,
}: {
  llm: LlmConfig;
  onChange: (l: LlmConfig) => void;
  onVerifiedChange?: (ok: boolean) => void;
}): React.JSX.Element {
  const t = useTheme();
  const [conn, setConn] = useState<Conn>({kind: 'idle'});
  const [probing, setProbing] = useState(false);
  const [probeMsg, setProbeMsg] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const signature = JSON.stringify([
    llm.enabled,
    llm.preset,
    llm.baseUrl,
    llm.apiKey,
  ]);

  useEffect(() => {
    setConn({kind: 'idle'});
    setProbeMsg(null);
    onVerifiedChange?.(!llm.enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    return () => abort.current?.abort();
  }, []);

  const set = (patch: Partial<LlmConfig>) => onChange({...llm, ...patch});

  const applyPreset = (id: LlmConfig['preset']) => {
    const p = LLM_PRESETS.find(x => x.id === id);
    if (!p) {
      return;
    }
    set({preset: id, baseUrl: p.baseUrl});
  };

  const runConnectionTest = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setConn({kind: 'working'});
    try {
      const models = await listModels(llm.baseUrl, llm.apiKey, {
        signal: ctrl.signal,
      });
      const current = (llm.model ?? '').trim();
      set({model: current && models.includes(current) ? current : models[0]});
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

  const runProbe = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProbing(true);
    setProbeMsg(null);
    try {
      await testLlm({...llm, enabled: true}, ctrl.signal);
      setProbeMsg('LLM answered — enhance will work.');
      if (conn.kind === 'manual') {
        setConn({kind: 'manual-ok'});
        onVerifiedChange?.(true);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'Cancelled.') {
        setProbeMsg(`Probe failed: ${msg}`);
      }
    } finally {
      setProbing(false);
    }
  };

  const showKey =
    llm.preset !== 'custom'
      ? (LLM_PRESETS.find(p => p.id === llm.preset)?.needsKey ?? true)
      : true;
  const modelLocked =
    (conn.kind === 'live' || conn.kind === 'manual-ok') &&
    (llm.model ?? '').trim() !== '';

  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginVertical: 8,
        }}>
        <Text style={{color: t.text, fontWeight: '700', fontSize: 15}}>
          Polish transcripts with an LLM
        </Text>
        <Switch value={llm.enabled} onValueChange={v => set({enabled: v})} />
      </View>
      {!llm.enabled ? (
        <Banner
          kind="info"
          text="Off — transcripts are used exactly as transcribed. You can enable this later in Providers."
        />
      ) : (
        <View>
          <PresetGrid
            items={LLM_PRESETS}
            value={llm.preset}
            onPick={p => applyPreset(p.id as LlmConfig['preset'])}
          />
          <Field
            title="Base URL"
            value={llm.baseUrl ?? ''}
            onChange={v => set({baseUrl: v, preset: 'custom'})}
            placeholder="https://api.openai.com/v1"
            keyboardType="url"
          />
          <ResolvedPreview
            method="Calls: POST"
            baseUrl={llm.baseUrl ?? ''}
            suffix="/chat/completions"
          />
          {showKey && (
            <Field
              title="API key (empty for keyless local gateways)"
              value={llm.apiKey ?? ''}
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
                value={llm.model ?? ''}
                onChange={m => set({model: m})}
              />
              <Row>
                <Btn
                  title="Send test prompt"
                  icon="send"
                  kind="ghost"
                  onPress={runProbe}
                />
              </Row>
            </View>
          )}
          {(conn.kind === 'manual' || conn.kind === 'manual-ok') && (
            <View>
              <Banner
                kind="info"
                text="This server has no model list endpoint — enter the model name manually, then send a test prompt."
              />
              <Field
                title="Model"
                value={llm.model ?? ''}
                onChange={v => {
                  set({model: v});
                  if (conn.kind === 'manual-ok') {
                    setConn({kind: 'manual'});
                    onVerifiedChange?.(false);
                  }
                }}
                placeholder="llama-3.3-70b-versatile"
              />
              {conn.kind === 'manual-ok' && (
                <Banner kind="ok" text="Test prompt answered." />
              )}
              <Row>
                <Btn title="Send test prompt" icon="send" onPress={runProbe} />
              </Row>
            </View>
          )}
          {probing && <Banner kind="info" text="Waiting for the model…" />}
          {!!probeMsg && !probing && (
            <Banner
              kind={probeMsg.startsWith('LLM answered') ? 'ok' : 'err'}
              text={probeMsg}
            />
          )}

          {modelLocked && (
            <Field
              title="System prompt (how transcripts get polished)"
              value={llm.systemPrompt}
              onChange={v => set({systemPrompt: v})}
              multiline
            />
          )}
        </View>
      )}
    </View>
  );
}
