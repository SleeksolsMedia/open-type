import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, ScrollView, Text, View, type AppStateStatus} from 'react-native';
import Animated, {FadeIn} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {LlmEditor} from '../LlmEditor';
import {SttEditor} from '../SttEditor';
import {log} from '../logging';
import {
  isAccessibilityEnabled,
  isBatteryExempt,
  isMicrophoneGranted,
  isNativeAvailable,
  isOverlayPermissionGranted,
  openAccessibilitySettings,
  requestBatteryExemption,
  requestMicrophonePermission,
  requestOverlayPermission,
  setOnboardingComplete,
} from '../native/modules';
import {fonts, spacing, useTheme} from '../theme';
import type {AppSettings} from '../types';
import {
  Banner,
  Btn,
  Card,
  CardTitle,
  Hero,
  Pill,
  Row,
  Stagger,
  StepDots,
} from '../ui';

const TITLES = [
  'Welcome',
  'Microphone',
  'Bubble',
  'Auto-paste',
  'Battery',
  'Speech-to-text',
  'LLM enhance',
  'Ready',
];

const STEP_ICONS = [
  'waveform',
  'microphone',
  'circle-double',
  'clipboard-check',
  'battery-check',
  'server',
  'sparkles',
  'check',
];

const STEP_EYEBROWS = [
  'Voice dictation, your models',
  'Step 1 of 4 · Permissions',
  'Step 2 of 4 · Permissions',
  'Step 3 of 4 · Permissions',
  'Step 4 of 4 · Permissions',
  'Your transcription provider',
  'Optional polish',
  'You are all set',
];

export function OnboardingWizard({
  settings,
  onChange,
  onComplete,
}: {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  onComplete: () => void;
}): React.JSX.Element {
  const t = useTheme();
  const [step, setStep] = useState(() =>
    Math.max(0, Math.min(TITLES.length - 1, settings.onboarding.step)),
  );
  const [sttOk, setSttOk] = useState(false);
  const [llmOk, setLlmOk] = useState(!settings.llm.enabled);

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(TITLES.length - 1, next));
      setStep(clamped);
      onChange({
        ...settings,
        onboarding: {completed: false, step: clamped},
      });
    },
    [onChange, settings],
  );

  const finish = useCallback(() => {
    log('info', 'onboarding', 'Completed');
    onChange({
      ...settings,
      onboarding: {completed: true, step: TITLES.length - 1},
    });
    // Lets the bubble service run while the app is backgrounded.
    setOnboardingComplete().catch(() => undefined);
    onComplete();
  }, [onChange, onComplete, settings]);

  return (
    <View style={{flex: 1, backgroundColor: t.bg}}>
      <ScrollView contentContainerStyle={{padding: 20, paddingBottom: 40}}>
        <Animated.View key={step} entering={FadeIn.duration(240)}>
          <StepHeader
            index={step}
            title={TITLES[step]}
            eyebrow={STEP_EYEBROWS[step]}
          />
        </Animated.View>
        <StepDots index={step} total={TITLES.length} />
        {step === 0 && <WelcomeStep onNext={() => go(1)} />}
        {step === 1 && (
          <PermStep
            icon="microphone"
            title="Microphone access"
            body="OpenType records your voice on this device. Audio is only sent to the transcription server you choose — or never leaves the phone with on-device mode."
            checkLabel="Grant microphone"
            checkHint="granted"
            missingHint="missing"
            check={async () => {
              if (!isNativeAvailable()) {
                return true;
              }
              if (await isMicrophoneGranted()) {
                return true;
              }
              return requestMicrophonePermission();
            }}
            onBack={() => go(0)}
            onNext={() => go(2)}
          />
        )}
        {step === 2 && (
          <PermStep
            icon="circle-double"
            title="Floating bubble"
            body="The bubble floats over other apps so you can dictate anywhere. Android opens system settings — enable “Allow display over other apps”, then come back; this screen verifies it automatically."
            checkLabel="Open overlay settings"
            checkHint="enabled"
            missingHint="not enabled"
            check={async () => {
              if (!isNativeAvailable()) {
                return true;
              }
              if (await isOverlayPermissionGranted()) {
                return true;
              }
              await requestOverlayPermission();
              return false;
            }}
            onBack={() => go(1)}
            onNext={() => go(3)}
          />
        )}
        {step === 3 && (
          <PermStep
            icon="clipboard-check"
            title="Auto-paste into any app"
            body="Accessibility access lets OpenType find the focused text field and insert your words. It is used for nothing else — no screen reading, no data collection. Enable “OpenType” in the list, then come back."
            checkLabel="Open accessibility settings"
            checkHint="enabled"
            missingHint="not enabled"
            check={async () => {
              if (!isNativeAvailable()) {
                return true;
              }
              if (await isAccessibilityEnabled()) {
                return true;
              }
              await openAccessibilitySettings();
              return false;
            }}
            onBack={() => go(2)}
            onNext={() => go(4)}
          />
        )}
        {step === 4 && (
          <BatteryStep onBack={() => go(3)} onNext={() => go(5)} />
        )}
        {step === 5 && (
          <View>
            <Stagger index={0}>
              <Card framed>
                <CardTitle serif>How should speech be transcribed?</CardTitle>
                <SttEditor
                  stt={settings.stt}
                  onChange={stt => onChange({...settings, stt})}
                  onVerifiedChange={setSttOk}
                />
              </Card>
            </Stagger>
            <Row>
              <Btn title="Back" icon="arrow-left" kind="ghost" onPress={() => go(4)} />
              <Btn
                title="Continue"
                icon="arrow-right"
                disabled={!sttOk}
                onPress={() => go(6)}
              />
            </Row>
            {!sttOk && (
              <Banner
                kind="warn"
                text="Run the 3-second test (or download + select an on-device model) to continue."
              />
            )}
          </View>
        )}
        {step === 6 && (
          <View>
            <Stagger index={0}>
              <Card framed>
                <CardTitle serif>Polish with an LLM? (optional)</CardTitle>
                <LlmEditor
                  llm={settings.llm}
                  onChange={llm => {
                    onChange({...settings, llm});
                    if (!llm.enabled) {
                      setLlmOk(true);
                    }
                  }}
                  onVerifiedChange={setLlmOk}
                />
              </Card>
            </Stagger>
            <Row>
              <Btn title="Back" icon="arrow-left" kind="ghost" onPress={() => go(5)} />
              <Btn title={settings.llm.enabled && !llmOk ? 'Test LLM to continue' : 'Continue'} icon="arrow-right" disabled={settings.llm.enabled && !llmOk} onPress={() => go(7)} />
            </Row>
          </View>
        )}
        {step === 7 && (
          <DoneStep
            settings={settings}
            onBack={() => go(6)}
            onStart={finish}
          />
        )}
      </ScrollView>
    </View>
  );
}

function StepHeader({
  index,
  title,
  eyebrow,
}: {
  index: number;
  title: string;
  eyebrow: string;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View style={{marginBottom: spacing.sm}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.md}}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: t.lavender,
            borderWidth: 2,
            borderColor: t.dark ? t.cream : t.ink,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon name={STEP_ICONS[index]} size={24} color={t.lavenderInk} />
        </View>
        <View>
          <Text style={{color: t.subtext, fontSize: 13, fontWeight: '700'}}>
            SETUP {index + 1} / {TITLES.length}
          </Text>
          <Text style={{color: t.forest, fontSize: 13, fontWeight: '600'}}>
            {eyebrow}
          </Text>
        </View>
      </View>
      <Text
        style={{
          fontFamily: fonts.display,
          color: t.text,
          fontSize: 38,
          lineHeight: 40,
          letterSpacing: -0.5,
        }}>
        {title}
      </Text>
    </View>
  );
}

function WelcomeStep({onNext}: {onNext: () => void}): React.JSX.Element {
  const t = useTheme();
  const points = [
    {icon: 'circle-double', title: 'Dictate anywhere', body: 'Tap the bubble in any app, speak, done — text is inserted automatically.'},
    {icon: 'server', title: 'Your models', body: 'Use OpenAI, Groq, your own server, or fully offline on-device transcription.'},
    {icon: 'sparkles', title: 'Optional polish', body: 'Clean up transcripts with any OpenAI-compatible LLM. No account, no vendor cloud.'},
  ];
  return (
    <View>
      <Stagger index={0}>
        <View style={{marginBottom: spacing.lg}}>
          <Hero
            title="Stop typing. Start speaking."
            subtitle="Open-source voice dictation where you bring your own models. History stays on this phone."
          />
        </View>
      </Stagger>
      {points.map((p, i) => (
        <Stagger key={p.title} index={i + 1}>
          <Card>
            <View style={{flexDirection: 'row', gap: 12, alignItems: 'flex-start'}}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: t.lavender,
                  borderWidth: 1.5,
                  borderColor: t.dark ? t.cream : t.ink,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Icon name={p.icon} size={22} color={t.lavenderInk} />
              </View>
              <View style={{flex: 1}}>
                <Text style={{color: t.text, fontWeight: '800', fontSize: 16, marginBottom: 2}}>
                  {p.title}
                </Text>
                <Text style={{color: t.subtext, fontSize: 14, lineHeight: 21}}>
                  {p.body}
                </Text>
              </View>
            </View>
          </Card>
        </Stagger>
      ))}
      <Text style={{color: t.subtext, fontSize: 13, marginBottom: 12, textAlign: 'center'}}>
        Setup takes ~3 minutes: 4 permissions, your transcription provider, optional LLM.
      </Text>
      <Btn title="Get started" icon="arrow-right" onPress={onNext} />
    </View>
  );
}

/** Generic gate: action button + auto re-verify on foreground return. */
function PermStep({
  icon,
  title,
  body,
  checkLabel,
  checkHint,
  missingHint,
  check,
  onBack,
  onNext,
}: {
  icon: string;
  title: string;
  body: string;
  checkLabel: string;
  checkHint: string;
  missingHint: string;
  check: () => Promise<boolean>;
  onBack: () => void;
  onNext: () => void;
}): React.JSX.Element {
  const t = useTheme();
  const [state, setState] = useState<'unknown' | 'checking' | 'ok' | 'missing'>(
    'unknown',
  );
  const busy = useRef(false);

  const verify = useCallback(async () => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setState('checking');
    try {
      setState((await check()) ? 'ok' : 'missing');
    } catch {
      setState('missing');
    } finally {
      busy.current = false;
    }
  }, [check]);

  useEffect(() => {
    verify();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        verify();
      }
    });
    return () => sub.remove();
  }, [verify]);

  return (
    <View>
      <Stagger index={0}>
        <Card framed>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.sm}}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: state === 'ok' ? t.forest : t.lavender,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Icon
                name={state === 'ok' ? 'check' : icon}
                size={22}
                color={state === 'ok' ? t.forestInk : t.lavenderInk}
              />
            </View>
            <View style={{flex: 1}}>
              <CardTitle serif>{title}</CardTitle>
            </View>
          </View>
          <Text style={{fontSize: 15, lineHeight: 23, color: t.text}}>{body}</Text>
          <View style={{marginTop: 8}}>
            {state === 'ok' && (
              <View style={{marginBottom: spacing.sm}}>
                <Pill tone="ok" text={`Verified — ${checkHint}`} dot />
              </View>
            )}
            {state === 'missing' && (
              <Banner kind="warn" text={`Still ${missingHint}. Complete it in system settings, then return here.`} />
            )}
            {(state === 'checking' || state === 'unknown') && (
              <Banner kind="info" text="Checking…" />
            )}
          </View>
        </Card>
      </Stagger>
      <Row>
        <Btn title="Back" icon="arrow-left" kind="ghost" onPress={onBack} />
        <Btn title={checkLabel} icon="cog" onPress={verify} />
      </Row>
      <Row>
        <Btn title="Check again" icon="refresh" kind="ghost" onPress={verify} />
        <Btn title="Continue" icon="arrow-right" disabled={state !== 'ok'} onPress={onNext} />
      </Row>
    </View>
  );
}

function BatteryStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}): React.JSX.Element {
  const t = useTheme();
  const [exempt, setExempt] = useState<boolean | null>(null);

  const verify = useCallback(async () => {
    if (!isNativeAvailable()) {
      setExempt(true);
      return;
    }
    setExempt(await isBatteryExempt().catch(() => false));
  }, []);

  useEffect(() => {
    verify();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        verify();
      }
    });
    return () => sub.remove();
  }, [verify]);

  return (
    <View>
      <Stagger index={0}>
        <Card framed>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.sm}}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: exempt === true ? t.forest : t.lavender,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Icon
                name={exempt === true ? 'check' : 'battery-check'}
                size={22}
                color={exempt === true ? t.forestInk : t.lavenderInk}
              />
            </View>
            <View style={{flex: 1}}>
              <CardTitle serif>Ignore battery optimizations</CardTitle>
            </View>
          </View>
          <Text style={{fontSize: 15, lineHeight: 23, color: t.text}}>
            Some phones kill background apps aggressively, which can stop the
            bubble or cut recordings short. Exempting OpenType keeps dictation
            reliable. OpenType does no background work on its own — this only
            protects active recordings.
          </Text>
          <View style={{marginTop: 8}}>
            {exempt == null && <Banner kind="info" text="Checking…" />}
            {exempt === true && (
              <View style={{marginBottom: spacing.sm}}>
                <Pill tone="ok" text="Verified — exemption granted" dot />
              </View>
            )}
            {exempt === false && (
              <Banner
                kind="warn"
                text="Not exempted yet. If your phone brand hides this setting, you can skip — dictation still works."
              />
            )}
          </View>
        </Card>
      </Stagger>
      <Row>
        <Btn title="Back" icon="arrow-left" kind="ghost" onPress={onBack} />
        <Btn
          title="Request exemption"
          icon="battery-check"
          onPress={async () => {
            try {
              await requestBatteryExemption();
            } catch {
              // Some ROMs lack the intent; user can skip.
            }
            setTimeout(verify, 500);
          }}
        />
      </Row>
      <Row>
        <Btn title="Check again" icon="refresh" kind="ghost" onPress={verify} />
        {exempt === true ? (
          <Btn title="Continue" icon="arrow-right" onPress={onNext} />
        ) : (
          <Btn title="Skip for now" icon="arrow-right" kind="ghost" onPress={onNext} />
        )}
      </Row>
    </View>
  );
}

function DoneStep({
  settings,
  onBack,
  onStart,
}: {
  settings: AppSettings;
  onBack: () => void;
  onStart: () => void;
}): React.JSX.Element {
  const t = useTheme();
  const sttSummary =
    settings.stt.kind === 'on-device'
      ? `On-device (${settings.stt.onDeviceModelId})`
      : `${settings.stt.baseUrl} · ${settings.stt.model}`;
  const rows = [
    {icon: 'microphone', label: 'Transcription', value: sttSummary},
    {icon: 'sparkles', label: 'LLM polish', value: settings.llm.enabled ? `on (${settings.llm.model})` : 'off'},
    {icon: 'circle-double', label: 'Bubble', value: 'appears in any text field'},
  ];
  return (
    <View>
      <Stagger index={0}>
        <Card framed style={{alignItems: 'center'}}>
          <View
            style={{
              width: 76,
              height: 76,
              borderRadius: 38,
              backgroundColor: t.forest,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: spacing.md,
            }}>
            <Icon name="check" size={38} color={t.forestInk} />
          </View>
          <Text
            style={{
              fontFamily: fonts.display,
              fontSize: 32,
              color: t.text,
              textAlign: 'center',
            }}>
            You're set up
          </Text>
          <Text
            style={{
              color: t.subtext,
              fontSize: 15,
              lineHeight: 23,
              textAlign: 'center',
              marginTop: spacing.sm,
            }}>
            Tap the bubble in any app (or the mic here), speak, tap stop —
            your words appear where the cursor is.
          </Text>
        </Card>
      </Stagger>
      {rows.map((r, i) => (
        <Stagger key={r.label} index={i + 1}>
          <Card>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: t.dark ? t.cardElevated : '#F2F2DF',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Icon name={r.icon} size={20} color={t.text} />
              </View>
              <View style={{flex: 1}}>
                <Text style={{color: t.subtext, fontSize: 12, fontWeight: '700'}}>
                  {r.label.toUpperCase()}
                </Text>
                <Text style={{color: t.text, fontSize: 15, fontWeight: '600'}} numberOfLines={2}>
                  {r.value}
                </Text>
              </View>
              <Icon name="check-circle" size={22} color={t.forest} />
            </View>
          </Card>
        </Stagger>
      ))}
      <Row>
        <Btn title="Back" icon="arrow-left" kind="ghost" onPress={onBack} />
        <Btn title="Start dictating" icon="microphone" onPress={onStart} />
      </Row>
    </View>
  );
}
