import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { Bucket, RiviumStorageException, StorageFile, UploadProgress } from '@rivium/storage-react-native';
import { HttpFailure, TransformRefusal, useModel } from './model';
import { formatBytes } from './bytes';

// ============================================================
// Theme (light and dark)
// ============================================================

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  return {
    dark,
    bg: dark ? '#000000' : '#F2F2F7',
    card: dark ? '#1C1C1E' : '#FFFFFF',
    text: dark ? '#FFFFFF' : '#111111',
    muted: dark ? '#A1A1AA' : '#6B7280',
    border: dark ? '#3A3A3C' : '#E5E7EB',
    input: dark ? '#2C2C2E' : '#F9FAFB',
    accent: '#4F46E5',
    green: dark ? '#4ADE80' : '#15803D',
    red: dark ? '#F87171' : '#B91C1C',
    orange: dark ? '#FBBF24' : '#B45309',
    /** WARN in "Run all checks" (the bucket setup differs): like SKIP, but violet so it stands out. */
    violet: dark ? '#C4B5FD' : '#6D28D9',
  };
}

export const mono = { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12 } as const;

// ============================================================
// Describing results and errors — every error shown, never swallowed
// ============================================================

export function describeError(error: unknown): string {
  if (error instanceof RiviumStorageException) {
    const parts = [`statusCode: ${error.statusCode ?? '-'}`];
    if (error.code) parts.push(`code: "${error.code}"`);
    return `RiviumStorageException(${parts.join(', ')})\n${error.message}`;
  }
  if (error instanceof TransformRefusal) return error.details;
  if (error instanceof HttpFailure) return `HTTP ${error.status}\n${error.body}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function describeFile(file: StorageFile): string {
  const lines = [
    `id: ${file.id}`,
    `path: ${file.path}`,
    `fileName: ${file.fileName}`,
    `mimeType: ${file.mimeType}`,
    `size: ${formatBytes(file.size)} (${file.size} B)`,
    `bucketId: ${file.bucketId}`,
  ];
  if (file.metadata && Object.keys(file.metadata).length) lines.push(`metadata: ${JSON.stringify(file.metadata)}`);
  if (file.uploadedBy) lines.push(`uploadedBy: ${file.uploadedBy}`);
  if (file.uploadedAt) lines.push(`uploadedAt: ${file.uploadedAt}`);
  lines.push(`createdAt: ${file.createdAt}`);
  return lines.join('\n');
}

export function describeBucket(b: Bucket): string {
  return [
    `name: ${b.name}`,
    `id: ${b.id}`,
    `visibility: ${b.visibility}`,
    `allowedMimeTypes: ${b.allowedMimeTypes?.join(', ') || 'any'}`,
    `maxFileSize: ${b.maxFileSize ? formatBytes(b.maxFileSize) : 'none'}`,
    `blockExecutables: ${b.blockExecutables ?? 'unknown'}`,
    `createdAt: ${b.createdAt}`,
  ].join('\n');
}

// ============================================================
// Building blocks
// ============================================================

export interface ActionOutput {
  text: string;
  /** Image URI that needs no headers (data: URI, public link, signed link). */
  imageUri?: string;
  /** Image loaded WITH headers (<Image source={{ uri, headers }}>). */
  imageWithHeaders?: { uri: string; headers: Record<string, string> };
  link?: string;
}

export type ActionState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'success'; output: ActionOutput }
  | { kind: 'failure'; message: string; title?: string };

export function Card({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.sectionTitle, { color: t.muted }]}>{children}</Text>;
}

export function Info({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.info, { color: t.muted }]}>{children}</Text>;
}

export function Button({
  title,
  onPress,
  disabled,
  destructive,
  secondary,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  secondary?: boolean;
}) {
  const t = useTheme();
  const color = destructive ? t.red : t.accent;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        secondary
          ? { borderWidth: 1, borderColor: color, backgroundColor: 'transparent' }
          : { backgroundColor: color },
        (pressed || disabled) && { opacity: 0.55 },
      ]}
    >
      <Text style={[styles.buttonText, { color: secondary ? color : '#FFFFFF' }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  placeholder?: string;
  secure?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={[styles.fieldLabel, { color: t.muted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? label}
        placeholderTextColor={t.muted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        style={[styles.input, { color: t.text, backgroundColor: t.input, borderColor: t.border }]}
      />
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { borderColor: t.accent }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && { backgroundColor: t.accent }]}
          >
            <Text style={{ color: selected ? '#FFFFFF' : t.accent, fontSize: 13, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ResultView({ state }: { state: ActionState }) {
  const t = useTheme();
  if (state.kind === 'idle') return null;
  if (state.kind === 'running') {
    return (
      <View style={styles.row}>
        <ActivityIndicator />
        <Text style={{ color: t.muted, marginLeft: 8 }}>Running…</Text>
      </View>
    );
  }
  if (state.kind === 'failure') {
    return (
      <View style={{ marginTop: 8 }}>
        <Text style={{ color: t.red, fontWeight: '700' }}>Error</Text>
        {state.title ? <Text style={{ color: t.red, fontWeight: '700', fontSize: 16, marginTop: 2 }}>{state.title}</Text> : null}
        <Text selectable style={[mono, { color: t.red }]}>
          {state.message}
        </Text>
      </View>
    );
  }
  const { output } = state;
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ color: t.green, fontWeight: '700' }}>Success</Text>
      <Text selectable style={[mono, { color: t.text }]}>
        {output.text}
      </Text>
      {output.imageUri ? <ResultImage source={{ uri: output.imageUri }} /> : null}
      {output.imageWithHeaders ? <ResultImage source={output.imageWithHeaders} /> : null}
      {output.link ? (
        <Pressable onPress={() => Linking.openURL(output.link!)}>
          <Text style={{ color: t.accent, marginTop: 6 }}>Open in the browser</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** An <Image> that shows its load error instead of staying blank. */
export function ResultImage({ source }: { source: { uri: string; headers?: Record<string, string> } }) {
  const t = useTheme();
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={{ marginTop: 8 }}>
      <Image
        source={source}
        style={styles.image}
        resizeMode="contain"
        onError={(e) => setError(String(e.nativeEvent.error ?? 'failed'))}
        onLoad={() => setError(null)}
      />
      {error ? <Text style={[mono, { color: t.red }]}>Image did not load: {error}</Text> : null}
    </View>
  );
}

/** A real progress bar for upload(…, { onProgress }): fraction plus bytes. */
export function UploadProgressBar({ progress }: { progress: UploadProgress | null }) {
  const t = useTheme();
  if (!progress) return null;
  const fraction = progress.totalBytes > 0 ? Math.min(1, progress.bytesSent / progress.totalBytes) : 0;
  return (
    <View style={{ marginBottom: 8 }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}>
      <View style={[styles.progressTrack, { backgroundColor: t.border }]}>
        <View style={[styles.progressFill, { backgroundColor: t.accent, width: `${fraction * 100}%` }]} />
      </View>
      <Text style={[mono, { color: t.muted, marginTop: 4 }]}>
        {Math.round(fraction * 100)}% · {formatBytes(progress.bytesSent)} of {formatBytes(progress.totalBytes)}
      </Text>
    </View>
  );
}

/** One SDK feature: what it is for, a button, and the visible result. */
export function ActionCard({
  title,
  info,
  button = 'Run',
  destructive,
  children,
  action,
}: {
  title: string;
  info: string;
  button?: string;
  destructive?: boolean;
  children?: React.ReactNode;
  action: () => Promise<ActionOutput | string>;
}) {
  const t = useTheme();
  const [state, setState] = useState<ActionState>({ kind: 'idle' });
  const run = async () => {
    setState({ kind: 'running' });
    try {
      const result = await action();
      setState({ kind: 'success', output: typeof result === 'string' ? { text: result } : result });
    } catch (e) {
      setState({ kind: 'failure', message: describeError(e), title: e instanceof TransformRefusal ? e.title : undefined });
    }
  };
  return (
    <Card>
      <Text style={[styles.title, { color: t.text }]}>{title}</Text>
      <Info>{info}</Info>
      {children}
      <Button title={button} onPress={run} disabled={state.kind === 'running'} destructive={destructive} />
      <ResultView state={state} />
    </Card>
  );
}

/** Triggers an error on purpose and shows whether it is the expected one. */
export function ExpectErrorCard({
  title,
  info,
  expected,
  matches,
  action,
}: {
  title: string;
  info: string;
  expected: string;
  matches: (e: unknown) => boolean;
  action: () => Promise<string>;
}) {
  const t = useTheme();
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<{ pass: boolean; text: string } | null>(null);
  const run = async () => {
    setRunning(true);
    setOutcome(null);
    try {
      const value = await action();
      setOutcome({ pass: false, text: `No error: the call succeeded.\n${value}` });
    } catch (e) {
      setOutcome({ pass: matches(e), text: describeError(e) });
    }
    setRunning(false);
  };
  return (
    <Card>
      <Text style={[styles.title, { color: t.text }]}>{title}</Text>
      <Info>{info}</Info>
      <Text style={[mono, { color: t.text, marginBottom: 8 }]}>Expected: {expected}</Text>
      <Button title="Trigger" onPress={run} disabled={running} secondary />
      {running ? <ActivityIndicator style={{ marginTop: 8 }} /> : null}
      {outcome ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ color: outcome.pass ? t.green : t.orange, fontWeight: '700' }}>
            {outcome.pass ? 'Got the expected error' : 'Not the expected result'}
          </Text>
          <Text selectable style={[mono, { color: t.text }]}>
            {outcome.text}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

export type TestBucket = 'public' | 'private';

export function BucketToggle({ value, onChange }: { value: TestBucket; onChange: (b: TestBucket) => void }) {
  return (
    <Segmented
      options={[
        { value: 'public', label: 'Public' },
        { value: 'private', label: 'Private (images)' },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}

/** Pick one of the files uploaded in this session, or type an id. */
export function RecentFilePicker({
  label,
  fileId,
  onChange,
  imagesOnly,
}: {
  label: string;
  fileId: string;
  onChange: (id: string) => void;
  imagesOnly?: boolean;
}) {
  const model = useModel();
  const t = useTheme();
  const files = model.recentFiles.filter((f) => !imagesOnly || f.mimeType.startsWith('image/'));
  return (
    <View>
      <Field label={label} value={fileId} onChangeText={onChange} placeholder="file id" />
      {files.length === 0 ? (
        <Info>{imagesOnly ? 'Upload an image first, or paste a file id.' : 'Upload a file first, or paste a file id.'}</Info>
      ) : (
        <View style={styles.chips}>
          {files.slice(0, 6).map((f) => (
            <Pressable
              key={f.id}
              onPress={() => onChange(f.id)}
              style={[styles.chip, { borderColor: f.id === fileId ? t.accent : t.border }]}
            >
              <Text numberOfLines={1} style={{ color: t.text, fontSize: 12, maxWidth: 220 }}>
                {f.path.split('/').pop()}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 12, marginBottom: 6 },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  info: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  button: { borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 4 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  fieldLabel: { fontSize: 12, marginBottom: 3 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  segmented: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, overflow: 'hidden', marginBottom: 10 },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  image: { width: '100%', height: 200, borderRadius: 8, backgroundColor: '#8882' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },
});
