import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {log} from './logging';
import {
  MODEL_CATALOG,
  deleteModel,
  downloadModel,
  isModelDownloaded,
} from './providers/models';
import {releaseOnDevice} from './providers/stt';
import {Banner, Btn, Pill, ProgressBar, Row, formatMB} from './ui';
import {useTheme} from './theme';

type RowState =
  | {kind: 'checking'}
  | {kind: 'ready'; downloaded: boolean}
  | {kind: 'downloading'; received: number; total: number; status?: string}
  | {kind: 'error'; message: string};

/**
 * One downloadable whisper.cpp model: download / progress / delete / select.
 * `selected` marks the active STT model; `onSelect` switches to it.
 */
export function ModelRow({
  modelId,
  selected,
  onSelect,
}: {
  modelId: string;
  selected: boolean;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const t = useTheme();
  const model = MODEL_CATALOG.find(m => m.id === modelId);
  const [state, setState] = useState<RowState>({kind: 'checking'});
  const handle = useRef<{cancel: () => void} | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!model) {
      return;
    }
    setState({kind: 'checking'});
    const ok = await isModelDownloaded(model.id);
    if (mounted.current) {
      setState({kind: 'ready', downloaded: ok});
    }
  }, [model]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
      handle.current?.cancel();
    };
  }, [refresh]);

  if (!model) {
    return <Banner kind="err" text={`Unknown model ${modelId}`} />;
  }

  const onDownload = () => {
    setState({kind: 'downloading', received: 0, total: model.sizeMB});
    const h = downloadModel(model.id, {
      onProgress: (rx, total) => {
        if (mounted.current) {
          setState(prev =>
            prev.kind === 'downloading'
              ? {kind: 'downloading', received: rx, total, status: prev.status}
              : prev,
          );
        }
      },
      onStatus: status => {
        if (mounted.current) {
          setState(prev =>
            prev.kind === 'downloading'
              ? {...prev, status}
              : prev,
          );
        }
      },
    });
    handle.current = h;
    h.done.then(
      () => {
        handle.current = null;
        log('info', 'models', `Ready: ${model.id}`);
        refresh();
      },
      (e: unknown) => {
        handle.current = null;
        if (mounted.current) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg === 'Cancelled.') {
            refresh();
          } else {
            setState({kind: 'error', message: msg});
          }
        }
      },
    );
  };

  const onDelete = async () => {
    await deleteModel(model.id);
    await releaseOnDevice();
    refresh();
  };

  return (
    <View
      style={{
        borderWidth: selected ? 2 : 1.5,
        borderColor: selected
          ? t.lavender
          : t.dark
            ? t.border
            : t.stone,
        borderRadius: 20,
        padding: 14,
        marginVertical: 6,
        backgroundColor: selected ? t.lavender : t.card,
      }}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor:
              selected
                ? t.lavenderInk
                : t.dark
                  ? t.cardElevated
                  : '#F2F2DF',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon
            name={selected ? 'check' : 'cellphone'}
            size={20}
            color={selected ? t.lavender : t.text}
          />
        </View>
        <View style={{flex: 1}}>
          <Text
            style={{
              color: selected ? t.lavenderInk : t.text,
              fontWeight: '800',
              fontSize: 15,
            }}>
            {model.label}
          </Text>
          <Text
            style={{
              color: selected ? t.lavenderInk : t.subtext,
              fontSize: 12,
              marginTop: 2,
              opacity: selected ? 0.75 : 1,
            }}>
            {model.detail}
          </Text>
        </View>
        <Pill
          tone={selected ? 'ok' : 'neutral'}
          text={`${model.sizeMB} MB`}
        />
      </View>
      {state.kind === 'checking' && (
        <Text style={{color: selected ? t.lavenderInk : t.subtext, marginTop: 8}}>Checking…</Text>
      )}
      {state.kind === 'ready' &&
        (state.downloaded ? (
          <Row>
            {!selected && (
              <Btn title="Use this model" icon="check" kind="ghost" onPress={() => onSelect(model.id)} />
            )}
            <Btn title="Delete" icon="delete" kind="danger" onPress={onDelete} />
          </Row>
        ) : (
          <Row>
            <Btn title={`Download (${model.sizeMB} MB)`} icon="download" onPress={onDownload} />
          </Row>
        ))}
      {state.kind === 'downloading' && (
        <View style={{marginTop: 8}}>
          {!!state.status && (
            <Text style={{color: selected ? t.lavenderInk : t.subtext, fontSize: 12}}>{state.status}</Text>
          )}
          <Text style={{color: selected ? t.lavenderInk : t.text, fontSize: 12, fontWeight: '600'}}>
            {formatMB(state.received * 1024 * 1024)} / {state.total.toFixed(0)} MB
          </Text>
          <ProgressBar fraction={state.total > 0 ? state.received / state.total : 0} />
          <Row>
            <Btn
              title="Cancel"
              icon="close"
              kind="ghost"
              onPress={() => handle.current?.cancel()}
            />
          </Row>
        </View>
      )}
      {state.kind === 'error' && (
        <View style={{marginTop: 8}}>
          <Banner kind="err" text={state.message} />
          <Row>
            <Btn title="Retry" icon="refresh" onPress={onDownload} />
            <Btn title="Dismiss" icon="close" kind="ghost" onPress={refresh} />
          </Row>
        </View>
      )}
    </View>
  );
}

export function ModelList({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <View>
      {MODEL_CATALOG.map(m => (
        <ModelRow
          key={m.id}
          modelId={m.id}
          selected={m.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}
