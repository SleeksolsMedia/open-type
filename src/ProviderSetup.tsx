import React, {useState} from 'react';
import {Pressable, ScrollView, Text, View} from 'react-native';
import Animated, {FadeIn} from 'react-native-reanimated';
import {AppIcon} from './ui';
import {normalizeBaseUrl} from './net';
import {fonts, radius, spacing, useTheme} from './theme';

export interface PresetLike {
  id: string;
  label: string;
  hint: string;
  baseUrl?: string;
  needsKey?: boolean;
}

const PRESET_ICONS: Record<string, string> = {
  openai: 'sparkles',
  groq: 'wave',
  selfhost: 'server',
  custom: 'cog',
};

/** One-tap provider cards — lavender wash + ink ring when active. */
export function PresetGrid<T extends PresetLike>({
  items,
  value,
  onPick,
}: {
  items: readonly T[];
  value: string;
  onPick: (p: T) => void;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View
      style={{flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 8}}>
      {items.map(p => {
        const active = value === p.id;
        return (
          <Pressable
            key={p.id}
            onPress={() => onPick(p)}
            style={{
              borderWidth: active ? 2 : 1.5,
              borderColor: active
                ? t.dark
                  ? t.coralFaint
                  : t.ink
                : t.dark
                  ? t.border
                  : t.line,
              borderRadius: radius.md,
              padding: 12,
              minWidth: '47%',
              flexGrow: 1,
              backgroundColor: active ? t.coralFaint : t.surface,
            }}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
              <AppIcon
                name={PRESET_ICONS[p.id] ?? 'server'}
                size={18}
                color={active ? t.ink : t.coralDark}
              />
              <Text
                style={{
                  color: active ? t.ink : t.text,
                  fontFamily: fonts.bodyBold,
                  fontSize: 15,
                  flex: 1,
                }}>
                {p.label}
              </Text>
              {active && (
                <AppIcon name="check-circle" size={18} color={t.ink} />
              )}
            </View>
            <Text
              style={{
                color: active ? t.ink : t.subtext,
                fontSize: 12,
                marginTop: 4,
                opacity: active ? 0.75 : 1,
              }}>
              {p.hint}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Shows the exact endpoint the app will call. Kills URL-guessing bugs. */
export function ResolvedPreview({
  method,
  baseUrl,
  suffix,
}: {
  method: string;
  baseUrl: string;
  suffix: string;
}): React.JSX.Element {
  const t = useTheme();
  let line = 'Enter a base URL above.';
  const norm = normalizeBaseUrl(baseUrl ?? '');
  if (norm) {
    line = `${method} ${norm}${suffix}`;
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: t.dark ? t.surfaceMuted : '#F2F2DF',
        borderRadius: radius.sm,
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginVertical: 4,
      }}>
      <AppIcon name="link" size={14} color={t.subtext} />
      <Text
        style={{color: t.subtext, fontSize: 12, fontFamily: fonts.mono, flex: 1}}
        selectable
        numberOfLines={2}>
        {line}
      </Text>
    </View>
  );
}

/** Dropdown over a live model list. */
export function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: string[];
  value: string;
  onChange: (m: string) => void;
}): React.JSX.Element {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{marginVertical: 8}}>
      <Text style={{color: t.text, fontFamily: fonts.bodySemiBold, fontSize: 13, marginBottom: 6}}>
        Model · {models.length} available
      </Text>
      <Pressable
        onPress={() => setOpen(o => !o)}
        style={{
          borderWidth: 2,
          borderColor: t.dark ? t.coralFaint : t.ink,
          borderRadius: 14,
          padding: 14,
          backgroundColor: t.inputBg,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
        <Text style={{color: t.text, fontFamily: fonts.bodySemiBold, flex: 1}} numberOfLines={1}>
          {value || 'Pick a model…'}
        </Text>
        <AppIcon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={t.subtext}
        />
      </Pressable>
      {open && (
        <Animated.View
          entering={FadeIn.duration(180)}
          style={{
            borderWidth: 1.5,
            borderColor: t.dark ? t.border : t.line,
            borderRadius: 14,
            marginTop: 6,
            backgroundColor: t.surface,
            overflow: 'hidden',
          }}>
          <ScrollView style={{maxHeight: 220}} nestedScrollEnabled>
            {models.map((m, i) => {
              const selected = m === value;
              return (
                <Pressable
                  key={m}
                  onPress={() => {
                    onChange(m);
                    setOpen(false);
                  }}
                  style={{
                    padding: 14,
                    borderBottomWidth: i === models.length - 1 ? 0 : 1,
                    borderColor: t.dark ? t.border : t.line,
                    backgroundColor: selected ? t.coralFaint : 'transparent',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                  <AppIcon
                    name={selected ? 'check-circle' : 'circle-outline'}
                    size={18}
                    color={selected ? t.ink : t.subtext}
                  />
                  <Text
                    style={{
                      color: selected ? t.ink : t.text,
                      fontFamily: selected ? fonts.bodySemiBold : fonts.body,
                      flex: 1,
                    }}
                    numberOfLines={1}>
                    {m}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}

/** Two-option kind toggle (Cloud / On-device) in the Calm Flow style. */
export function KindToggle({
  options,
  value,
  onChange,
}: {
  options: {id: string; label: string; icon: string}[];
  value: string;
  onChange: (id: string) => void;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: t.dark ? t.surfaceMuted : t.line,
        borderRadius: radius.pill,
        padding: 4,
        gap: 4,
        marginVertical: spacing.sm,
      }}>
      {options.map(o => {
        const active = value === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              borderRadius: radius.pill,
              paddingVertical: 11,
              backgroundColor: active ? t.coralFaint : 'transparent',
              borderWidth: active ? 1.5 : 0,
              borderColor: t.line,
            }}>
            <AppIcon
              name={o.icon}
              size={17}
              color={active ? t.ink : t.subtext}
            />
            <Text
              style={{
                color: active ? t.ink : t.subtext,
                fontFamily: active ? fonts.bodyBold : fonts.bodyMedium,
                fontSize: 14,
              }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
