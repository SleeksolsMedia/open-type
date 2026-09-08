/**
 * HistoryTab — last 15 days of dictations, no day grouping, with copy
 * button on every row. Filter to last 15 days per user spec.
 */
import React, {useMemo, useState} from 'react';
import {FlatList, Pressable, Text, View} from 'react-native';
import Animated, {FadeInUp} from 'react-native-reanimated';
import {
  AppIcon,
  Card,
  ConfirmSheet,
  EmptyState,
  PageHeader,
  Pill,
  Stagger,
  Toast,
} from '../ui';
import {CopyRow} from '../widgets';
import {fonts, motion, spacing, useTheme} from '../theme';
import type {HistoryEntry} from '../types';
import {clearHistory, deleteHistoryEntry} from '../store/settings';
import {insertOrCopy} from '../native/modules';
import {haptic} from '../haptics';

interface Props {
  history: HistoryEntry[];
  onHistory: (h: HistoryEntry[]) => void;
  onHome: () => void;
  hapticsEnabled: boolean;
}

const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

export function HistoryTab({
  history,
  onHistory,
  onHome,
  hapticsEnabled,
}: Props): React.JSX.Element {
  const t = useTheme();
  const [toast, setToast] = useState<{key: string; message: string} | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const showToast = (message: string) => {
    setToast({key: `${Date.now()}`, message});
  };

  // Filter to last 15 days.
  const filtered = useMemo(() => {
    const cutoff = Date.now() - FIFTEEN_DAYS_MS;
    return history.filter(h => h.createdAt >= cutoff);
  }, [history]);

  if (history.length === 0) {
    return (
      <View style={{flex: 1}}>
        <PageHeader eyebrow="History" title="Nothing here yet." />
        <EmptyState
          title="No dictations yet"
          body="Tap any text field in another app — the orb appears. Hold to speak."
          actionLabel="Back to Home"
          onAction={onHome}
        />
      </View>
    );
  }

  return (
    <View style={{flex: 1}}>
      <PageHeader
        eyebrow="History"
        title={`${filtered.length} dictations`}
        trailing={
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirmClear(true)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: t.line,
              backgroundColor: t.surface,
            }}>
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                color: t.inkMid,
              }}>
              Clear all
            </Text>
          </Pressable>
        }
      />
      <ConfirmSheet
        visible={confirmClear}
        title={`Clear all ${history.length} dictations?`}
        body="Transcripts are removed from this phone only. This cannot be undone."
        confirmLabel="Clear all"
        destructive
        onConfirm={async () => {
          await clearHistory();
          onHistory([]);
          setConfirmClear(false);
          showToast('History cleared.');
        }}
        onCancel={() => setConfirmClear(false)}
      />
      <Toast
        messageKey={toast?.key ?? ''}
        message={toast?.message ?? null}
        onHide={() => setToast(null)}
      />
      <FlatList
        data={filtered}
        keyExtractor={h => h.id}
        contentContainerStyle={{paddingBottom: 40, paddingHorizontal: spacing.lg}}
        renderItem={({item, index}) => (
          <Stagger index={Math.min(index, 5)}>
            <HistoryRow
              entry={item}
              onCopy={async () => {
                await insertOrCopy(item.finalText);
                haptic('insert-ok', hapticsEnabled);
                showToast('Copied to clipboard.');
              }}
              onDelete={async () => {
                haptic('perm-denied', hapticsEnabled);
                onHistory(await deleteHistoryEntry(item.id));
              }}
            />
          </Stagger>
        )}
      />
    </View>
  );
}

function HistoryRow({
  entry,
  onCopy: _onCopy,
  onDelete,
}: {
  entry: HistoryEntry;
  onCopy: () => void;
  onDelete: () => Promise<void>;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <Animated.View entering={FadeInUp.duration(motion.small)}>
      <Card style={{marginBottom: spacing.sm}}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: spacing.sm,
          }}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                color: t.inkLow,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
              }}>
              {formatStamp(entry.createdAt)}
            </Text>
            <Pill
              tone={entry.usedEnhance ? 'amber' : 'neutral'}
              text={entry.usedEnhance ? 'Polished' : 'Raw'}
            />
            {entry.sourceApp && (
              <Pill tone="neutral" text={labelApp(entry.sourceApp)} />
            )}
          </View>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <CopyRow text={entry.finalText} />
            <Pressable
              accessibilityRole="button"
              onPress={onDelete}
              hitSlop={6}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: t.surfaceMuted,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <AppIcon name="delete" size={16} color={t.inkMid} />
            </Pressable>
          </View>
        </View>
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 14,
            color: t.ink,
            lineHeight: 21,
          }}>
          {entry.finalText}
        </Text>
      </Card>
    </Animated.View>
  );
}

function labelApp(p: string): string {
  const last = p.split('.').pop() ?? p;
  return last.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatStamp(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  const time = `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
  if (sameDay) {
    return `Today ${time}`;
  }
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) {
    return `Yesterday ${time}`;
  }
  return `${d.toLocaleDateString()} ${time}`;
}
