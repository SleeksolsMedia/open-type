/**
 * SettingsTab — Bubble / Theme / Haptics / Enhance default / Orb preview / Data / About.
 *
 * User additions (approved):
 *   - Theme toggle (System / Light / Dark)
 *   - Haptics toggle
 *   - Auto-enhance default link
 *   - Orb size preview
 *   - (No language)
 *
 * Removes: the legacy permission rows (moved to Home → System health).
 */
import React, {useEffect, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {
  AppIcon,
  Banner,
  Btn,
  Card,
  CardTitle,
  PageHeader,
  Row,
  SegmentedControl,
  Stagger,
  ToggleSwitch,
} from '../ui';
import {VoicebarOrb} from '../Orb';
import {fonts, radius, spacing, useTheme} from '../theme';
import type {AppSettings} from '../types';
import {
  isBubbleEnabled,
  setBubbleAppearance,
  setBubbleEnabled,
} from '../native/modules';
import {log} from '../logging';
import {formatLogs, getLogs} from '../logging';
import ReactNativeBlobUtil from 'react-native-blob-util';

interface Props {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  onChangeTheme: (mode: 'system' | 'light' | 'dark') => void;
  onChangeHaptics: (v: boolean) => void;
}

const SIZE_OPTIONS = [70, 85, 100, 115] as const;
const OPACITY_OPTIONS = [40, 60, 80, 100] as const;

export function SettingsTab({
  settings,
  onChange,
  onChangeTheme,
  onChangeHaptics,
}: Props): React.JSX.Element {
  const t = useTheme();
  const [logPath, setLogPath] = useState('');
  const [bubbleOn, setBubbleOn] = useState<boolean | null>(null);

  useEffect(() => {
    isBubbleEnabled().then(setBubbleOn).catch(() => setBubbleOn(true));
  }, []);

  const setAppearance = (size: number, opacity: number) => {
    onChange({...settings, bubbleSize: size, bubbleOpacity: opacity});
    setBubbleAppearance(size, opacity).catch(() => undefined);
  };

  const exportLogs = async () => {
    try {
      const path = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/opentype-logs.txt`;
      await ReactNativeBlobUtil.fs.writeFile(path, formatLogs(getLogs()), 'utf8');
      setLogPath(path);
      log('info', 'settings', `Logs exported to ${path}`);
    } catch (e) {
      setLogPath(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <ScrollView contentContainerStyle={{paddingBottom: 40}}>
      <PageHeader eyebrow="Settings" title="Tune the bubble." />

      <View style={{paddingHorizontal: spacing.lg}}>
        {/* Appearance / theme */}
        <Stagger index={0}>
          <View style={{marginTop: spacing.md}}>
            <Section title="Appearance" />
            <Card framed>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: spacing.sm,
                }}>
                <AppIcon name="circle-double" size={18} color={t.coral} />
                <CardTitle>Theme</CardTitle>
              </View>
              <SegmentedControl
                options={['system', 'light', 'dark'] as const}
                value={settings.themeMode}
                onChange={onChangeTheme}
                renderLabel={v => (v === 'system' ? 'Auto' : v === 'light' ? 'Light' : 'Dark')}
              />
              <Text
                style={{
                  color: t.inkMid,
                  fontFamily: fonts.body,
                  fontSize: 12,
                  marginTop: 6,
                  lineHeight: 17,
                }}>
                Auto follows your phone's system theme.
              </Text>
            </Card>
          </View>
        </Stagger>

        {/* Bubble */}
        <Stagger index={1}>
          <View style={{marginTop: spacing.lg}}>
            <Section title="Bubble" />
            <Card>
              <Row style={{borderBottomWidth: 1, borderColor: t.line}}>
                <View style={{flex: 1}}>
                  <Text style={{color: t.ink, fontFamily: fonts.bodySemiBold, fontSize: 14}}>
                    Show in text fields
                  </Text>
                  <Text
                    style={{
                      color: t.inkMid,
                      fontFamily: fonts.body,
                      fontSize: 12,
                      marginTop: 2,
                    }}>
                    The orb appears when you tap a text field in another app.
                  </Text>
                </View>
                <ToggleSwitch
                  value={bubbleOn ?? true}
                  onValueChange={async v => {
                    setBubbleOn(v);
                    await setBubbleEnabled(v);
                  }}
                />
              </Row>
              <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.md}}>
                <Text style={{color: t.ink, fontFamily: fonts.bodySemiBold, fontSize: 14}}>
                  Live preview
                </Text>
                <View
                  style={{
                    height: 130,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: t.line,
                    backgroundColor: t.bg,
                    marginTop: spacing.sm,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: settings.bubbleOpacity / 100,
                  }}>
                  <VoicebarOrb
                    state="idle"
                    sizeScale={settings.bubbleSize / 100}
                    idleOpacity={1}
                  />
                  <Text
                    style={{
                      color: t.inkLow,
                      fontFamily: fonts.mono,
                      fontSize: 10,
                      letterSpacing: 1.2,
                      marginTop: spacing.sm,
                    }}>
                    {settings.bubbleSize}% · {settings.bubbleOpacity}% OPACITY
                  </Text>
                </View>
              </View>
              <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.md}}>
                <Text
                  style={{
                    color: t.ink,
                    fontFamily: fonts.bodySemiBold,
                    fontSize: 13,
                  }}>
                  Size
                </Text>
                <View style={{marginTop: 6}}>
                  <SegmentedControl
                    options={SIZE_OPTIONS}
                    value={settings.bubbleSize as 70 | 85 | 100 | 115}
                    onChange={v => setAppearance(v, settings.bubbleOpacity)}
                    renderLabel={v => `${v}`}
                    mono
                  />
                </View>
              </View>
              <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md}}>
                <Text
                  style={{
                    color: t.ink,
                    fontFamily: fonts.bodySemiBold,
                    fontSize: 13,
                  }}>
                  Idle opacity
                </Text>
                <View style={{marginTop: 6}}>
                  <SegmentedControl
                    options={OPACITY_OPTIONS}
                    value={settings.bubbleOpacity as 40 | 60 | 80 | 100}
                    onChange={v => setAppearance(settings.bubbleSize, v)}
                    renderLabel={v => `${v}`}
                    mono
                  />
                </View>
              </View>
            </Card>
          </View>
        </Stagger>

        {/* Haptics */}
        <Stagger index={2}>
          <View style={{marginTop: spacing.lg}}>
            <Section title="Haptics" />
            <Card>
              <Row>
                <View style={{flex: 1}}>
                  <Text style={{color: t.ink, fontFamily: fonts.bodySemiBold, fontSize: 14}}>
                    Tactile feedback
                  </Text>
                  <Text
                    style={{
                      color: t.inkMid,
                      fontFamily: fonts.body,
                      fontSize: 12,
                      marginTop: 2,
                      lineHeight: 17,
                    }}>
                    Vibrations on recording start, stop, insert, and permission errors.
                  </Text>
                </View>
                <ToggleSwitch
                  value={settings.hapticsEnabled}
                  onValueChange={onChangeHaptics}
                />
              </Row>
            </Card>
          </View>
        </Stagger>

        {/* Defaults */}
        <Stagger index={3}>
          <View style={{marginTop: spacing.lg}}>
            <Section title="Defaults" />
            <Card>
              <Row>
                <View style={{flex: 1}}>
                  <Text style={{color: t.ink, fontFamily: fonts.bodySemiBold, fontSize: 14}}>
                    Auto-enhance transcripts
                  </Text>
                  <Text
                    style={{
                      color: t.inkMid,
                      fontFamily: fonts.body,
                      fontSize: 12,
                      marginTop: 2,
                    }}>
                    {settings.enhanceByDefault
                      ? 'On · each dictation is polished by your LLM'
                      : 'Off · raw transcripts are inserted'}
                  </Text>
                </View>
                <ToggleSwitch
                  value={settings.enhanceByDefault}
                  onValueChange={v =>
                    onChange({...settings, enhanceByDefault: v})
                  }
                />
              </Row>
            </Card>
          </View>
        </Stagger>

        {/* Data */}
        <Stagger index={4}>
          <View style={{marginTop: spacing.lg}}>
            <Section title="Data" />
            <Card>
              <Row>
                <View style={{flex: 1}}>
                  <Text style={{color: t.ink, fontFamily: fonts.bodySemiBold, fontSize: 14}}>
                    Redo setup wizard
                  </Text>
                  <Text
                    style={{
                      color: t.inkMid,
                      fontFamily: fonts.body,
                      fontSize: 12,
                      marginTop: 2,
                    }}>
                    Re-runs the permission flow.
                  </Text>
                </View>
                <Btn
                  title="Redo"
                  icon="refresh"
                  kind="ghost"
                  onPress={() =>
                    onChange({...settings, onboarding: {completed: false, step: 0}})
                  }
                />
              </Row>
              <Row style={{borderTopWidth: 1, borderColor: t.line}}>
                <View style={{flex: 1}}>
                  <Text style={{color: t.ink, fontFamily: fonts.bodySemiBold, fontSize: 14}}>
                    Export debug logs
                  </Text>
                  <Text
                    style={{
                      color: t.inkMid,
                      fontFamily: fonts.body,
                      fontSize: 12,
                      marginTop: 2,
                    }}>
                    Saves a text file to this app's document folder.
                  </Text>
                </View>
                <Btn title="Export" icon="file-export" kind="ghost" onPress={exportLogs} />
              </Row>
              {!!logPath && (
                <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.sm}}>
                  <Banner kind="info" text={logPath} />
                </View>
              )}
            </Card>
          </View>
        </Stagger>

        {/* About */}
        <Stagger index={5}>
          <View style={{marginTop: spacing.lg}}>
            <Section title="About" />
            <Card>
              <View style={{paddingVertical: 4}}>
                <Text
                  style={{
                    color: t.ink,
                    fontFamily: fonts.bodySemiBold,
                    fontSize: 14,
                  }}>
                  OpenType
                </Text>
                <Text
                  style={{
                    color: t.inkMid,
                    fontFamily: fonts.mono,
                    fontSize: 11,
                    letterSpacing: 0.6,
                    marginTop: 4,
                    textTransform: 'uppercase',
                  }}>
                  Open-source BYOM dictation
                </Text>
                <View style={{height: 1, backgroundColor: t.line, marginVertical: spacing.md}} />
                <Text
                  style={{
                    color: t.inkMid,
                    fontFamily: fonts.body,
                    fontSize: 12,
                    lineHeight: 18,
                  }}>
                  Transcription: {describeStt(settings)}
                  {'\n'}LLM: {settings.llm.enabled ? 'enabled' : 'off'}
                </Text>
              </View>
            </Card>
          </View>
        </Stagger>
      </View>
    </ScrollView>
  );
}

function describeStt(s: AppSettings): string {
  if (s.stt.kind === 'on-device') {
    return `on-device · ${s.stt.onDeviceModelId || 'tiny.en'}`;
  }
  return s.stt.preset;
}

function Section({title}: {title: string}): React.JSX.Element {
  const t = useTheme();
  return (
    <Text
      style={{
        fontFamily: fonts.mono,
        fontSize: 10,
        color: t.inkLow,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        marginBottom: spacing.sm,
      }}>
      {title}
    </Text>
  );
}