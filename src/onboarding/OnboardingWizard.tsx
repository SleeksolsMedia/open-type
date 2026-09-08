/**
 * OnboardingWizard — sequential 5-step setup.
 *
 * Key fix vs previous version:
 *   - Permissions step is sequential, NOT parallel. User taps "Enable Mic"
 *     → system dialog opens → on return, mic is re-checked. ONLY after mic
 *     is granted does the "Display over apps" row appear. This kills the
 *     double-redirect race where the user landed on one system settings
 *     page while another deep-link fired.
 *   - Success screen drops confetti from the top of the screen.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AppState,
  ScrollView,
  Text,
  View,
  type AppStateStatus,
} from 'react-native';
import Animated, {FadeIn} from 'react-native-reanimated';
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
  AppIcon,
  Btn,
  Card,
  CardTitle,
  Pill,
  Row,
  Stagger,
  StepDots,
  VoicebarOrb,
} from '../ui';
import {Confetti} from '../widgets';
import {haptic} from '../haptics';

const STEPS = [
  {title: 'Welcome', eyebrow: '3 quick steps to dictating anywhere'},
  {title: 'Permissions', eyebrow: 'Step 1 · grant access one by one'},
  {title: 'Battery', eyebrow: 'Step 2 · optional, skippable'},
  {title: 'Voice setup', eyebrow: 'Step 3 · your models, verified'},
  {title: 'Ready', eyebrow: 'You are all set'},
];

type PermKey = 'mic' | 'overlay' | 'a11y';
type PermState = 'unknown' | 'granted' | 'missing';

interface Props {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  onComplete: () => void;
  hapticsEnabled: boolean;
}

export function OnboardingWizard({
  settings,
  onChange,
  onComplete,
  hapticsEnabled,
}: Props): React.JSX.Element {
  const t = useTheme();
  const [step, setStep] = useState(() =>
    Math.max(0, Math.min(STEPS.length - 1, settings.onboarding.step)),
  );
  const [sttOk, setSttOk] = useState(false);
  const [llmOk, setLlmOk] = useState(!settings.llm.enabled);

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(STEPS.length - 1, next));
      setStep(clamped);
      onChange({...settings, onboarding: {completed: false, step: clamped}});
    },
    [onChange, settings],
  );

  const finish = useCallback(() => {
    log('info', 'onboarding', 'Completed');
    onChange({
      ...settings,
      onboarding: {completed: true, step: STEPS.length - 1},
    });
    setOnboardingComplete().catch(() => undefined);
    haptic('download-done', hapticsEnabled);
    onComplete();
  }, [onChange, onComplete, settings, hapticsEnabled]);

  return (
    <View style={{flex: 1, backgroundColor: t.bg}}>
      <ScrollView contentContainerStyle={{paddingBottom: 40}}>
        <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.sm}}>
          <Stagger index={0}>
            <StepHeader
              title={STEPS[step].title}
              eyebrow={STEPS[step].eyebrow}
            />
            <StepDots
              index={step}
              total={STEPS.length}
              label={`Step ${step + 1} of ${STEPS.length}`}
            />
          </Stagger>
        </View>

        <Animated.View key={step} entering={FadeIn.duration(240)}>
          {step === 0 && <WelcomeStep onNext={() => go(1)} />}
          {step === 1 && (
            <PermissionsStep onBack={() => go(0)} onNext={() => go(2)} />
          )}
          {step === 2 && (
            <BatteryStep onBack={() => go(1)} onNext={() => go(3)} />
          )}
          {step === 3 && (
            <VoiceStep
              settings={settings}
              onChange={onChange}
              sttOk={sttOk}
              llmOk={llmOk}
              onSttOk={setSttOk}
              onLlmOk={setLlmOk}
              onBack={() => go(2)}
              onNext={() => go(4)}
            />
          )}
          {step === 4 && (
            <ReadyStep
              onBack={() => go(3)}
              onStart={finish}
            />
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Step header                                                        */
/* ------------------------------------------------------------------ */

function StepHeader({
  title,
  eyebrow,
}: {
  title: string;
  eyebrow: string;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View style={{paddingTop: spacing.md, paddingBottom: spacing.sm}}>
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 10,
          color: t.inkLow,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
        }}>
        {eyebrow}
      </Text>
      <Text
        style={{
          fontFamily: fonts.bodyExtraBold,
          fontSize: 36,
          lineHeight: 38,
          color: t.ink,
          letterSpacing: -0.8,
          marginTop: 6,
        }}>
        {title}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Step 0: Welcome                                                    */
/* ------------------------------------------------------------------ */

function WelcomeStep({onNext}: {onNext: () => void}): React.JSX.Element {
  const t = useTheme();
  const points = [
    {
      icon: 'circle-double',
      title: 'Dictate in any app',
      body: 'Tap a text field — the orb appears. Hold to speak, release to insert.',
    },
    {
      icon: 'server',
      title: 'Your models, your keys',
      body: 'OpenAI, Groq, your own server, or fully offline on this phone.',
    },
    {
      icon: 'sparkles',
      title: 'Optional LLM polish',
      body: 'Filler words removed, punctuation fixed. History never leaves the device.',
    },
  ];
  return (
    <View style={{paddingHorizontal: spacing.lg}}>
      <Stagger index={1}>
        <Card framed style={{alignItems: 'center', paddingVertical: spacing.lg}}>
          <VoicebarOrb state="idle" inline sizeScale={1} />
          <Text
            style={{
              fontFamily: fonts.bodySemiBold,
              fontSize: 18,
              color: t.ink,
              marginTop: spacing.md,
              letterSpacing: -0.2,
            }}>
            Stop typing. Start speaking.
          </Text>
          <Text
            style={{
              color: t.inkMid,
              fontFamily: fonts.body,
              fontSize: 14,
              textAlign: 'center',
              marginTop: 6,
              lineHeight: 20,
              maxWidth: 280,
            }}>
            Three quick steps and you'll dictate anywhere on this phone.
          </Text>
        </Card>
      </Stagger>
      {points.map((p, i) => (
        <Stagger key={p.title} index={2 + i}>
          <Card style={{marginTop: spacing.sm}}>
            <View style={{flexDirection: 'row', gap: 12, alignItems: 'flex-start'}}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 12,
                  backgroundColor: t.coralFaint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <AppIcon name={p.icon} size={18} color={t.coral} />
              </View>
              <View style={{flex: 1}}>
                <Text style={{color: t.ink, fontFamily: fonts.bodySemiBold, fontSize: 14}}>
                  {p.title}
                </Text>
                <Text
                  style={{
                    color: t.inkMid,
                    fontFamily: fonts.body,
                    fontSize: 13,
                    marginTop: 4,
                    lineHeight: 18,
                  }}>
                  {p.body}
                </Text>
              </View>
            </View>
          </Card>
        </Stagger>
      ))}
      <Stagger index={5}>
        <View style={{marginTop: spacing.lg}}>
          <Btn title="Get started" icon="arrow-right" onPress={onNext} fullWidth />
        </View>
      </Stagger>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1: Permissions (SEQUENTIAL one-by-one)                          */
/* ------------------------------------------------------------------ */

interface PermDef {
  key: PermKey;
  label: string;
  icon: string;
  benefit: string;
  hint: string;
  actionLabel: string;
  open: () => Promise<void>;
  check: () => Promise<boolean>;
}

const PERM_ORDER: PermDef[] = [
  {
    key: 'mic',
    label: 'Microphone',
    icon: 'microphone',
    benefit: 'Hear your voice',
    hint: "We'll prompt for the OS-level mic permission.",
    actionLabel: 'Enable microphone',
    open: async () => {
      await requestMicrophonePermission();
    },
    check: async () =>
      isNativeAvailable()
        ? isMicrophoneGranted().catch(() => false)
        : true,
  },
  {
    key: 'overlay',
    label: 'Display over apps',
    icon: 'circle-double',
    benefit: 'Float the orb over any app',
    hint: "Open the system settings and turn on 'Display over other apps' for OpenType.",
    actionLabel: 'Open display settings',
    open: async () => {
      await requestOverlayPermission();
    },
    check: async () =>
      isNativeAvailable()
        ? isOverlayPermissionGranted().catch(() => false)
        : true,
  },
  {
    key: 'a11y',
    label: 'Accessibility',
    icon: 'clipboard-check',
    benefit: 'Type words into the focused field',
    hint: "Find OpenType in Accessibility, turn it on. It only finds the text field — nothing is read or stored.",
    actionLabel: 'Open accessibility settings',
    open: async () => {
      await openAccessibilitySettings();
    },
    check: async () =>
      isNativeAvailable()
        ? isAccessibilityEnabled().catch(() => false)
        : true,
  },
];

function PermissionsStep({
  onBack: _onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}): React.JSX.Element {
  const t = useTheme();
  const [states, setStates] = useState<Record<PermKey, PermState>>({
    mic: 'unknown',
    overlay: 'unknown',
    a11y: 'unknown',
  });
  const verifying = useRef<Record<PermKey, boolean>>({mic: false, overlay: false, a11y: false});

  const verify = useCallback(
    async (key: PermKey) => {
      if (verifying.current[key]) {
        return;
      }
      verifying.current[key] = true;
      const def = PERM_ORDER.find(p => p.key === key);
      if (!def) {
        return;
      }
      try {
        const ok = await def.check();
        setStates(prev => ({...prev, [key]: ok ? 'granted' : 'missing'}));
      } catch {
        setStates(prev => ({...prev, [key]: 'missing'}));
      } finally {
        verifying.current[key] = false;
      }
    },
    [],
  );

  // Re-check ALL granted perms whenever the app comes back to foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        for (const key of Object.keys(states) as PermKey[]) {
          verify(key);
        }
      }
    });
    return () => sub.remove();
  }, [states, verify]);

  // Initial verification of the first permission only.
  useEffect(() => {
    verify('mic');
  }, [verify]);

  const allOk = (Object.keys(states) as PermKey[]).every(k => states[k] === 'granted');

  return (
    <View style={{paddingHorizontal: spacing.lg}}>
      <Text
        style={{
          color: t.inkMid,
          fontFamily: fonts.body,
          fontSize: 14,
          lineHeight: 20,
          marginTop: spacing.sm,
          marginBottom: spacing.md,
        }}>
        Grant each one in order. After the first is granted, the next appears.
      </Text>
      {(Object.keys(PERM_ORDER) as Array<keyof typeof PERM_ORDER>).map(idxStr => {
        const idx = Number(idxStr);
        const def = PERM_ORDER[idx];
        const prev = idx > 0 ? PERM_ORDER[idx - 1] : null;
        const prevOk = !prev || states[prev.key] === 'granted';
        if (!prevOk) {
          return null;
        }
        const state = states[def.key];
        const ok = state === 'granted';
        return (
          <Stagger key={def.key} index={idx}>
            <Card framed style={{marginBottom: spacing.sm}}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    backgroundColor: ok ? t.done : t.coral,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <AppIcon
                    name={ok ? 'check' : def.icon}
                    size={20}
                    color="#fff"
                  />
                </View>
                <View style={{flex: 1}}>
                  <Text
                    style={{
                      color: t.ink,
                      fontFamily: fonts.bodySemiBold,
                      fontSize: 15,
                    }}>
                    {def.benefit}
                  </Text>
                  <Text
                    style={{
                      color: t.inkMid,
                      fontFamily: fonts.body,
                      fontSize: 13,
                      marginTop: 2,
                      lineHeight: 18,
                    }}>
                    {def.hint}
                  </Text>
                </View>
              </View>
              <View style={{marginTop: spacing.md}}>
                {ok ? (
                  <Pill tone="ok" text="Granted" dot />
                ) : (
                  <Row>
                    <Btn
                      title={def.actionLabel}
                      icon="arrow-right"
                      onPress={async () => {
                        await def.open();
                      }}
                    />
                    <Btn
                      title="Re-check"
                      icon="refresh"
                      kind="ghost"
                      onPress={() => verify(def.key)}
                    />
                  </Row>
                )}
              </View>
            </Card>
          </Stagger>
        );
      })}
      <Stagger index={4}>
        <View style={{marginTop: spacing.md}}>
          <Btn
            title={allOk ? 'Continue' : 'Grant all to continue'}
            icon="arrow-right"
            disabled={!allOk}
            onPress={onNext}
            fullWidth
          />
        </View>
      </Stagger>
      {allOk && (
        <Stagger index={5}>
          <View style={{alignItems: 'center', marginTop: spacing.md}}>
            <Pill tone="ok" text="All permissions granted" dot />
          </View>
        </Stagger>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2: Battery                                                     */
/* ------------------------------------------------------------------ */

function BatteryStep({
  onBack: _onBack,
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
    <View style={{paddingHorizontal: spacing.lg}}>
      <Stagger index={1}>
        <Card framed>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                backgroundColor: t.coralFaint,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <AppIcon name="battery-check" size={22} color={t.coral} />
            </View>
            <View style={{flex: 1}}>
              <Text
                style={{
                  color: t.ink,
                  fontFamily: fonts.bodySemiBold,
                  fontSize: 15,
                }}>
                Keep dictation alive in background
              </Text>
              <Text
                style={{
                  color: t.inkMid,
                  fontFamily: fonts.body,
                  fontSize: 13,
                  marginTop: 2,
                  lineHeight: 18,
                }}>
                Some phones kill background apps and cut recordings short. Exempting OpenType prevents that.
              </Text>
            </View>
          </View>
          <View style={{marginTop: spacing.md}}>
            {exempt == null && <Text style={{color: t.inkLow, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1}}>CHECKING…</Text>}
            {exempt === true && <Pill tone="ok" text="Exemption granted" dot />}
            {exempt === false && (
              <Text style={{color: t.amberDark, fontFamily: fonts.body, fontSize: 13, lineHeight: 18}}>
                Not exempted yet. If your phone hides this setting, skip — dictation still works.
              </Text>
            )}
          </View>
        </Card>
      </Stagger>
      <Stagger index={2}>
        <View style={{marginTop: spacing.md}}>
          {exempt === true ? (
            <Btn title="Continue" icon="arrow-right" onPress={onNext} fullWidth />
          ) : (
            <View style={{gap: spacing.sm}}>
              <Btn
                title="Exempt OpenType"
                icon="battery-check"
                onPress={async () => {
                  try {
                    await requestBatteryExemption();
                  } catch {
                    // Some ROMs lack the intent.
                  }
                  setTimeout(verify, 600);
                }}
                fullWidth
              />
              <Btn
                title="Skip for now"
                icon="arrow-right"
                kind="ghost"
                onPress={onNext}
                fullWidth
              />
            </View>
          )}
        </View>
      </Stagger>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3: Voice setup                                                  */
/* ------------------------------------------------------------------ */

function VoiceStep({
  settings,
  onChange,
  sttOk,
  llmOk,
  onSttOk,
  onLlmOk,
  onBack: _onBack,
  onNext,
}: {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  sttOk: boolean;
  llmOk: boolean;
  onSttOk: (ok: boolean) => void;
  onLlmOk: (ok: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}): React.JSX.Element {
  const ready = sttOk && llmOk;
  return (
    <View style={{paddingHorizontal: spacing.lg}}>
      <Stagger index={1}>
        <Card framed>
          <CardTitle>How should speech be transcribed?</CardTitle>
          <SttEditor
            stt={settings.stt}
            onChange={stt => onChange({...settings, stt})}
            onVerifiedChange={onSttOk}
          />
        </Card>
      </Stagger>
      <Stagger index={2}>
        <View style={{marginTop: spacing.md}}>
          <Card>
            <CardTitle>Polish with an LLM? (optional)</CardTitle>
            <LlmEditor
              llm={settings.llm}
              onChange={llm => {
                onChange({...settings, llm});
                if (!llm.enabled) {
                  onLlmOk(true);
                }
              }}
              onVerifiedChange={onLlmOk}
            />
          </Card>
        </View>
      </Stagger>
      <Stagger index={3}>
        <View style={{marginTop: spacing.md}}>
          {ready ? (
            <Btn title="Continue" icon="arrow-right" onPress={onNext} fullWidth />
          ) : (
            <Btn
              title="Verify above to continue"
              icon="arrow-right"
              disabled
              onPress={() => {}}
              fullWidth
            />
          )}
        </View>
      </Stagger>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Step 4: Ready — confetti + success orb pulse                         */
/* ------------------------------------------------------------------ */

function ReadyStep({
  onStart,
}: {
  onBack: () => void;
  onStart: () => void;
}): React.JSX.Element {
  const t = useTheme();
  const [done, setDone] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setDone(true), 200);
    return () => clearTimeout(id);
  }, []);
  return (
    <View style={{flex: 1, paddingHorizontal: spacing.lg}}>
      <View style={{height: 180, justifyContent: 'flex-end', alignItems: 'center'}}>
        <Confetti />
        <VoicebarOrb state={done ? 'done' : 'idle'} inline sizeScale={1.2} />
      </View>
      <Stagger index={1}>
        <View style={{alignItems: 'center', marginTop: spacing.xl}}>
          <Text
            style={{
              fontFamily: fonts.bodyExtraBold,
              fontSize: 32,
              color: t.ink,
              textAlign: 'center',
              letterSpacing: -0.6,
            }}>
            You're set up
          </Text>
          <Text
            style={{
              color: t.inkMid,
              fontFamily: fonts.body,
              fontSize: 15,
              lineHeight: 22,
              textAlign: 'center',
              marginTop: spacing.sm,
              maxWidth: 320,
            }}>
            Open any app, tap a text field, hold the orb, speak, release. Your words appear where the cursor is.
          </Text>
        </View>
      </Stagger>
      <Stagger index={2}>
        <View style={{marginTop: spacing.xl}}>
          <Btn title="Start dictating" icon="arrow-right" onPress={onStart} fullWidth />
        </View>
      </Stagger>
    </View>
  );
}

