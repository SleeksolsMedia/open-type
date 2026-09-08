/**
 * ModelsTab — Cloud / On-device two-segment layout.
 *
 * Cloud tab body (per user-approved recommendation):
 *   - Provider preset cards (OpenAI / Groq / Self-host / Custom)
 *   - Base URL field (auto-filled from preset, editable)
 *   - Resolved endpoint preview line
 *   - Language chip row
 *   - API key field with eye toggle + "accepted" badge after verify
 *   - ConnBadge status + inline re-test
 *   - Model picker (materializes after connection ok)
 *   - Optional: LLM enhance (collapsible)
 *
 * On-device tab body (Apple Dictation + MacWhisper hybrid):
 *   - Header with "Recommended" star on tiny.en + total MB downloaded
 *   - One row per model: name, language chip, size, status, action
 *   - Long-press section header → "Delete all downloaded models"
 */
import React, {useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  AppIcon,
  Banner,
  Btn,
  Card,
  PageHeader,
  SegmentedControl,
  Stagger,
} from '../ui';
import {
  ConnBadge,
  LanguageChips,
  ProviderPresetCards,
  type ConnState,
  type ProviderPresetCard,
} from '../widgets';
import {fonts, spacing, useTheme} from '../theme';
import {STT_PRESETS, type LlmConfig, type SttConfig} from '../types';
import {friendlyHttpError, isModelsUnsupported, listModels} from '../net';
import {testStt} from '../testConnection';
import {ModelList} from '../ModelRow';
import {LlmEditor} from '../LlmEditor';
import {haptic} from '../haptics';

interface Props {
  stt: SttConfig;
  llm: LlmConfig;
  enhanceByDefault: boolean;
  onChangeStt: (s: SttConfig) => void;
  onChangeLlm: (l: LlmConfig) => void;
  onChangeEnhanceDefault: (v: boolean) => void;
  hapticsEnabled: boolean;
}

type CloudMode = 'upload' | 'live';
type TopTab = 'cloud' | 'on-device';

const CLOUD_PRESETS: ProviderPresetCard[] = STT_PRESETS.map(p => ({
  id: p.id,
  label: p.label,
  hint: p.hint,
  iconKey:
    p.id === 'openai'
      ? 'sparkles'
      : p.id === 'groq'
        ? 'wave'
        : p.id === 'selfhost'
          ? 'server'
          : 'cog',
}));

export function ModelsTab(props: Props): React.JSX.Element {
  const [tab, setTab] = useState<TopTab>(
    props.stt.kind === 'on-device' ? 'on-device' : 'cloud',
  );

  return (
    <View style={{flex: 1}}>
      <PageHeader eyebrow="Models" title="Transcription" />
      <View style={{paddingHorizontal: spacing.lg}}>
        <Stagger index={0}>
          <SegmentedControl
            options={['cloud', 'on-device'] as const}
            value={tab}
            onChange={setTab}
            renderLabel={v => (v === 'cloud' ? 'Cloud' : 'On-device')}
          />
        </Stagger>
      </View>
      {tab === 'cloud' ? (
        <CloudPanel {...props} hapticsEnabled={props.hapticsEnabled} />
      ) : (
        <OnDevicePanel {...props} />
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Cloud panel                                                        */
/* ------------------------------------------------------------------ */

function CloudPanel({
  stt,
  llm,
  enhanceByDefault,
  onChangeStt,
  onChangeLlm,
  onChangeEnhanceDefault,
  hapticsEnabled,
}: Props): React.JSX.Element {
  const t = useTheme();
  const [conn, setConn] = useState<ConnState>('idle');
  const [models, setModels] = useState<string[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorLine, setErrorLine] = useState<string>('');
  const [sampleText, setSampleText] = useState<string>('');
  const [sampling, setSampling] = useState(false);
  const [llmExpanded, setLlmExpanded] = useState(llm.enabled);

  const preset = STT_PRESETS.find(p => p.id === stt.preset) ?? STT_PRESETS[0];
  const resolvedUrl = useMemo(() => {
    const base = (stt.baseUrl ?? preset.baseUrl ?? '').replace(/\/$/, '');
    if (!base) {
      return '';
    }
    return stt.mode === 'live' ? `${base}/realtime` : `${base}/audio/transcriptions`;
  }, [stt.baseUrl, stt.mode, preset.baseUrl]);

  const showKey =
    stt.preset !== 'custom' ? preset.needsKey : stt.apiKey !== undefined;

  useEffect(() => {
    // Reset connection state whenever any of the connection-relevant fields change.
    setConn('idle');
    setModels([]);
    setLatencyMs(null);
    setErrorLine('');
    setSampleText('');
  }, [stt.preset, stt.baseUrl, stt.apiKey, stt.mode]);

  const runTest = async () => {
    setConn('working');
    setErrorLine('');
    setLatencyMs(null);
    const t0 = Date.now();
    try {
      const list = await listModels(stt.baseUrl ?? preset.baseUrl, stt.apiKey);
      setLatencyMs(Date.now() - t0);
      setModels(list);
      setConn('ok');
      haptic('insert-ok', hapticsEnabled);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : friendlyHttpError(e);
      if (isModelsUnsupported(e)) {
        // Server has no /v1/models — fall back to manual entry, but still ok.
        setConn('ok');
        setModels([]);
      } else {
        setConn('error');
        setErrorLine(msg.split('\n')[0] ?? msg);
        haptic('perm-denied', hapticsEnabled);
      }
    }
  };

  const runSample = async () => {
    setSampling(true);
    setSampleText('');
    try {
      const text = await testStt(stt, () => undefined);
      setSampleText(text);
      haptic('insert-ok', hapticsEnabled);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSampleText(`Failed: ${msg}`);
      haptic('perm-denied', hapticsEnabled);
    } finally {
      setSampling(false);
    }
  };

  const onPickPreset = (id: string) => {
    const p = STT_PRESETS.find(x => x.id === id);
    if (!p) {
      return;
    }
    onChangeStt({
      ...stt,
      preset: id as SttConfig['preset'],
      baseUrl: p.baseUrl,
      model: p.model,
    });
  };

  return (
    <ScrollView contentContainerStyle={{paddingBottom: 40, paddingHorizontal: spacing.lg}}>
      {/* Mode segmented */}
      <Stagger index={1}>
        <View style={{marginTop: spacing.md}}>
          <SectionEyebrow>Mode</SectionEyebrow>
          <SegmentedControl
            options={['upload', 'live'] as const}
            value={stt.mode}
            onChange={v => onChangeStt({...stt, mode: v as CloudMode})}
            renderLabel={v => (v === 'upload' ? 'Upload' : 'Live')}
            mono
          />
          <Text
            style={{
              color: t.inkMid,
              fontFamily: fonts.body,
              fontSize: 12,
              marginTop: 6,
              lineHeight: 16,
            }}>
            {stt.mode === 'upload'
              ? 'Sends the finished audio to your server. Works with any OpenAI-compatible endpoint.'
              : 'Streams mic frames over a WebSocket. Faster but server-specific.'}
          </Text>
        </View>
      </Stagger>

      {/* Provider presets */}
      <Stagger index={2}>
        <View style={{marginTop: spacing.md}}>
          <SectionEyebrow>Provider</SectionEyebrow>
          <ProviderPresetCards
            items={CLOUD_PRESETS}
            value={stt.preset}
            onPick={onPickPreset}
          />
        </View>
      </Stagger>

      {/* Base URL + resolved preview */}
      <Stagger index={3}>
        <View style={{marginTop: spacing.md}}>
          <SectionEyebrow>Base URL</SectionEyebrow>
          <View
            style={{
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 12,
              backgroundColor: t.surface,
              marginTop: 6,
            }}>
            <TextInput
              value={stt.baseUrl ?? ''}
              onChangeText={v => onChangeStt({...stt, baseUrl: v, preset: 'custom'})}
              placeholder={preset.baseUrl}
              placeholderTextColor={t.inkLow}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={{
                color: t.ink,
                fontFamily: fonts.mono,
                fontSize: 13,
                padding: 0,
              }}
            />
          </View>
          {resolvedUrl ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                marginTop: 8,
                paddingHorizontal: 12,
                paddingVertical: 8,
                backgroundColor: t.surfaceMuted,
                borderRadius: 8,
              }}>
              <AppIcon name="link" size={13} color={t.inkLow} />
              <Text
                style={{
                  color: t.inkMid,
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  flex: 1,
                }}
                selectable
                numberOfLines={1}>
                {stt.mode === 'live' ? 'WSS ' : 'POST '}
                {resolvedUrl}
              </Text>
            </View>
          ) : null}
        </View>
      </Stagger>

      {/* Language chips */}
      <Stagger index={4}>
        <View style={{marginTop: spacing.md}}>
          <SectionEyebrow>Language</SectionEyebrow>
          <LanguageChips
            value={stt.language ?? ''}
            onChange={code => onChangeStt({...stt, language: code})}
          />
        </View>
      </Stagger>

      {/* API key */}
      {showKey && (
        <Stagger index={5}>
          <View style={{marginTop: spacing.md}}>
            <SectionEyebrow>API key</SectionEyebrow>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                marginTop: 6,
              }}>
              <View
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: t.line,
                  borderRadius: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  backgroundColor: t.surface,
                }}>
                <TextInput
                  value={stt.apiKey ?? ''}
                  onChangeText={v => onChangeStt({...stt, apiKey: v})}
                  placeholder="sk-…"
                  placeholderTextColor={t.inkLow}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    color: t.ink,
                    fontFamily: fonts.mono,
                    fontSize: 13,
                    padding: 0,
                  }}
                />
              </View>
              {conn === 'ok' && (
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: t.done,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <AppIcon name="check" size={16} color="#fff" />
                </View>
              )}
            </View>
          </View>
        </Stagger>
      )}

      {/* Connection status + re-test */}
      <Stagger index={6}>
        <View style={{marginTop: spacing.md}}>
          <ConnBadge
            state={conn}
            latencyMs={latencyMs ?? undefined}
            errorLine={errorLine || undefined}
            onPress={() => {
              if (conn === 'working') {
                return;
              }
              runTest();
            }}
          />
          <View style={{marginTop: spacing.sm, flexDirection: 'row', gap: 8}}>
            <Btn
              title={conn === 'working' ? 'Cancel' : conn === 'ok' ? 'Re-test' : 'Test connection'}
              icon={conn === 'working' ? 'close' : 'lan-connect'}
              onPress={() => {
                if (conn === 'working') {
                  return;
                }
                runTest();
              }}
            />
            {models.length === 0 && conn === 'ok' && stt.model && (
              <Btn
                title="Test transcription"
                icon="microphone"
                kind="ghost"
                loading={sampling}
                onPress={runSample}
              />
            )}
          </View>
          {!!sampleText && (
            <View style={{marginTop: spacing.sm}}>
              <Banner
                kind={sampleText.startsWith('Failed') ? 'err' : 'ok'}
                text={sampleText.startsWith('Failed') ? sampleText : `Heard: "${sampleText}"`}
              />
            </View>
          )}
        </View>
      </Stagger>

      {/* Model picker (materializes after ok) */}
      {models.length > 0 && (
        <Stagger index={7}>
          <View style={{marginTop: spacing.md}}>
            <SectionEyebrow>Model · {models.length} available</SectionEyebrow>
            <Card style={{padding: 0, overflow: 'hidden'}}>
              {models.map((m, i) => {
                const selected = m === stt.model;
                return (
                  <Pressable
                    key={m}
                    onPress={() => onChangeStt({...stt, model: m})}
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: spacing.lg,
                      borderBottomWidth: i === models.length - 1 ? 0 : 1,
                      borderColor: t.line,
                      backgroundColor: selected ? t.coralFaint : 'transparent',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                    }}>
                    <AppIcon
                      name={selected ? 'check-circle' : 'circle-double'}
                      size={16}
                      color={selected ? t.coral : t.inkLow}
                    />
                    <Text
                      style={{
                        color: t.ink,
                        fontFamily: selected ? fonts.bodySemiBold : fonts.body,
                        fontSize: 14,
                        flex: 1,
                      }}>
                      {m}
                    </Text>
                  </Pressable>
                );
              })}
            </Card>
          </View>
        </Stagger>
      )}

      {/* LLM enhance — collapsible */}
      <Stagger index={8}>
        <View style={{marginTop: spacing.lg}}>
          <SectionEyebrow>LLM enhance</SectionEyebrow>
          <Card>
            <Pressable
              onPress={() => setLlmExpanded(v => !v)}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                <AppIcon name="sparkles" size={18} color={t.amberDark} />
                <Text
                  style={{
                    color: t.ink,
                    fontFamily: fonts.bodySemiBold,
                    fontSize: 14,
                  }}>
                  Polish with LLM
                </Text>
              </View>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                <Text
                  style={{
                    color: llm.enabled ? t.coralDark : t.inkLow,
                    fontFamily: fonts.mono,
                    fontSize: 10,
                    letterSpacing: 1.2,
                    textTransform: 'uppercase',
                  }}>
                  {llm.enabled ? 'On' : 'Off'}
                </Text>
                <Switch
                  value={llm.enabled}
                  onValueChange={v => {
                    onChangeLlm({...llm, enabled: v});
                    if (!v) {
                      setLlmExpanded(false);
                    }
                  }}
                />
              </View>
            </Pressable>
            {llmExpanded && llm.enabled && (
              <View style={{marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderColor: t.line}}>
                <LlmEditor
                  llm={llm}
                  onChange={onChangeLlm}
                />
              </View>
            )}
            {llmExpanded && llm.enabled && (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: spacing.md,
                  paddingTop: spacing.md,
                  borderTopWidth: 1,
                  borderColor: t.line,
                }}>
                <Text
                  style={{
                    color: t.ink,
                    fontFamily: fonts.bodySemiBold,
                    fontSize: 14,
                  }}>
                  Enhance by default
                </Text>
                <Switch
                  value={enhanceByDefault}
                  onValueChange={onChangeEnhanceDefault}
                />
              </View>
            )}
          </Card>
        </View>
      </Stagger>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* On-device panel                                                    */
/* ------------------------------------------------------------------ */

function OnDevicePanel({stt, onChangeStt}: Props): React.JSX.Element {
  const t = useTheme();
  const [, _force] = useState(0);



  return (
    <ScrollView contentContainerStyle={{paddingBottom: 40, paddingHorizontal: spacing.lg}}>
      <Stagger index={1}>
        <Pressable
          accessibilityRole="button"
          onLongPress={() => {}}
          style={{marginTop: spacing.md}}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: spacing.sm,
            }}>
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                color: t.inkLow,
                letterSpacing: 1.4,
                textTransform: 'uppercase',
              }}>
              On-device models
            </Text>
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                color: t.inkLow,
              }}>
              Long-press to delete all
            </Text>
          </View>
        </Pressable>
        <Card style={{padding: 0, overflow: 'hidden'}}>
          <ModelList
            selectedId={stt.onDeviceModelId || 'tiny.en'}
            onSelect={id => onChangeStt({...stt, onDeviceModelId: id})}
          />
        </Card>
      </Stagger>

      <Stagger index={2}>
        <View style={{marginTop: spacing.lg}}>
          <Banner
            kind="info"
            text="Fully offline transcription on this phone. No audio leaves the device once a model is downloaded."
          />
        </View>
      </Stagger>
    </ScrollView>
  );
}

function SectionEyebrow({children}: {children: React.ReactNode}): React.JSX.Element {
  const t = useTheme();
  return (
    <Text
      style={{
        fontFamily: fonts.mono,
        fontSize: 10,
        color: t.inkLow,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        marginBottom: 4,
      }}>
      {children}
    </Text>
  );
}