import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { StorageFile, UploadProgress } from '@rivium/storage-react-native';
import { useModel } from '../model';
import { Samples } from '../samples';
import { isPngNotAllowed, PNG_NOT_ALLOWED } from '../noisePng';
import { base64ToBytes, dataUri, formatBytes, fromUtf8 } from '../bytes';
import {
  ActionCard,
  ActionState,
  BucketToggle,
  Button,
  Card,
  Field,
  Info,
  ResultView,
  SectionTitle,
  TestBucket,
  UploadProgressBar,
  describeError,
  describeFile,
  mono,
  useTheme,
} from '../ui';

// ============================================================
// Upload
// ============================================================

export function UploadScreen() {
  const model = useModel();
  const [bucket, setBucket] = useState<TestBucket>('public');
  const [path, setPath] = useState('');
  const [contentType, setContentType] = useState('text/plain');
  const [text, setText] = useState('Hello from Rivium Storage');
  const [metaKey, setMetaKey] = useState('source');
  const [metaValue, setMetaValue] = useState('react-native-example');
  const [picked, setPicked] = useState<ActionState>({ kind: 'idle' });
  const [pickedProgress, setPickedProgress] = useState<UploadProgress | null>(null);
  const [bigProgress, setBigProgress] = useState<UploadProgress | null>(null);

  const bucketName = bucket === 'public' ? model.settings.publicBucket : model.settings.privateBucket;
  const defaultPath = (name: string) => model.userFolder + name;

  /** Every picker ends here: bytes → upload(). */
  const uploadPicked = async (bytes: Uint8Array, name: string, type: string) => {
    setPicked({ kind: 'running' });
    setPickedProgress(null);
    try {
      const file = await model.storage.upload(bucketName, defaultPath(name), bytes, {
        contentType: type,
        metadata: { source: 'picker' },
        onProgress: setPickedProgress,
      });
      model.remember(file);
      setPicked({
        kind: 'success',
        output: { text: describeFile(file), imageUri: type.startsWith('image/') ? dataUri(bytes, type) : undefined },
      });
    } catch (e) {
      setPicked({ kind: 'failure', message: describeError(e) });
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets[0];
      // The SDK takes bytes, so read the picked file (base64) into a Uint8Array.
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      await uploadPicked(base64ToBytes(base64), asset.name, asset.mimeType ?? 'application/octet-stream');
    } catch (e) {
      setPicked({ kind: 'failure', message: describeError(e) });
    }
  };

  const pickImage = async (camera: boolean) => {
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setPicked({ kind: 'failure', message: `Permission not granted (${permission.status}).` });
        return;
      }
      // quality < 1 makes the picker re-encode to JPEG (no HEIC surprises).
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], base64: true, quality: 0.85 };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset.base64) throw new Error('The picker returned no image data.');
      const name = `${camera ? 'camera' : 'photo'}-${Samples.stamp()}.jpg`;
      await uploadPicked(base64ToBytes(asset.base64), name, asset.mimeType ?? 'image/jpeg');
    } catch (e) {
      setPicked({ kind: 'failure', message: describeError(e) });
    }
  };

  return (
    <View>
      <Info>
        upload(bucketId, path, data, options) sends bytes (Uint8Array or string) with a content type and optional metadata.
        The server checks the REAL content: allowed types, size limit, blocked executables and your access rules. Pass
        onProgress in the options to show how much has been sent; the last call has bytesSent === totalBytes.
      </Info>
      <BucketToggle value={bucket} onChange={setBucket} />

      <SectionTitle>Bytes you have in memory</SectionTitle>
      <ActionCard
        title="Upload text with metadata"
        info="UploadOptions { contentType, metadata }. Metadata comes back on getFile and listFiles. Leave contentType empty and the SDK guesses it from the file extension."
        action={async () => {
          const target = path || defaultPath(`note-${Samples.stamp()}.txt`);
          const file = await model.storage.upload(bucketName, target, text, {
            contentType: contentType || undefined,
            metadata: metaKey ? { [metaKey]: metaValue, uploadedAt: new Date().toISOString() } : undefined,
          });
          model.remember(file);
          return describeFile(file);
        }}
      >
        <Field label="Path in the bucket" value={path} onChangeText={setPath} placeholder={defaultPath('note.txt')} />
        <Field label="Content type" value={contentType} onChangeText={setContentType} />
        <Field label="Text to upload (a string is sent as UTF-8)" value={text} onChangeText={setText} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="Metadata key" value={metaKey} onChangeText={setMetaKey} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Value" value={metaValue} onChangeText={setMetaValue} />
          </View>
        </View>
      </ActionCard>
      <ActionCard
        title="Upload a PNG (Uint8Array)"
        info="A real image as bytes. Goes to your folder (users/<you>/…) in the private bucket so the userFolders rule allows it."
        action={async () => {
          const bytes = Samples.png();
          const file = await model.storage.upload(bucketName, model.userFolder + `generated-${Samples.stamp()}.png`, bytes, {
            contentType: 'image/png',
            metadata: { kind: 'generated' },
          });
          model.remember(file);
          return { text: describeFile(file), imageUri: dataUri(bytes, 'image/png') };
        }}
      />

      <SectionTitle>Upload progress</SectionTitle>
      <ActionCard
        title="Upload a generated 5 MB PNG"
        info="upload(…, { onProgress }) with a ~5 MB PNG of noise pixels (noise doesn't compress) to the public bucket, so the bar visibly moves. It is a real image/png, so buckets that allow only images accept it. onProgress gets { bytesSent, totalBytes } (the whole request, a little more than the file)."
        action={async () => {
          setBigProgress(null);
          const bytes = Samples.noisePng(1300, 1300);
          let last: UploadProgress | null = null;
          const started = Date.now();
          let file;
          try {
            file = await model.storage.upload(model.settings.publicBucket, model.userFolder + `progress-${Samples.stamp()}/progress-test.png`, bytes, {
              contentType: 'image/png',
              onProgress: (p) => {
                last = p;
                setBigProgress(p);
              },
            });
          } catch (e) {
            if (isPngNotAllowed(e)) return `Skipped: ${PNG_NOT_ALLOWED}\n\nServer said: ${(e as Error).message}`;
            throw e;
          }
          model.remember(file);
          const seconds = ((Date.now() - started) / 1000).toFixed(1);
          const end = last as UploadProgress | null;
          const lastText = end ? `${end.bytesSent} of ${end.totalBytes} B (${Math.round((end.bytesSent / end.totalBytes) * 100)}%)` : 'none';
          return `${describeFile(file)}\n\nlast progress: ${lastText}\ntook ${seconds} s`;
        }}
      >
        <UploadProgressBar progress={bigProgress} />
      </ActionCard>

      <SectionTitle>File names</SectionTitle>
      <ActionCard
        title="Unicode file name: رسید-۸۸۱۲.pdf"
        info="Names in any script are kept as typed, here a Persian receipt name with Persian digits. Uploaded as a PDF to the public bucket, then found again by path."
        action={async () => {
          const file = await model.storage.upload(model.settings.publicBucket, model.userFolder + 'receipts/رسید-۸۸۱۲.pdf', Samples.pdf('Receipt 8812'), {
            contentType: 'application/pdf',
          });
          model.remember(file);
          const back = await model.storage.getFileByPath(model.settings.publicBucket, file.path);
          return `${describeFile(file)}\n\ngetFileByPath found it again: ${back.id === file.id}`;
        }}
      />
      <ActionCard
        title="Name with spaces"
        info={'"my holiday photo 01.png": spaces are fine in paths.'}
        action={async () => {
          const file = await model.storage.upload(bucketName, model.userFolder + 'my holiday photo 01.png', Samples.png(), {
            contentType: 'image/png',
          });
          model.remember(file);
          const back = await model.storage.getFileByPath(bucketName, file.path);
          return `${describeFile(file)}\n\ngetFileByPath found it again: ${back.id === file.id}`;
        }}
      />

      <SectionTitle>Signed upload link (your server)</SectionTitle>
      <ActionCard
        title="Upload through a signed upload link"
        info="For big files or when your server must approve each upload: your server makes a short-lived link with the server secret (POST /signed-upload on the example server), the app PUTs the bytes with the same Content-Type, and your server confirms it (POST /confirm-upload). The SDK has no method for this, so it is plain fetch; the file is then read back with the SDK."
        action={async () => {
          const bytes = Samples.png();
          const { file, log } = await model.signedUpload(bytes, 'image/png', `signed-${Samples.stamp()}.png`);
          model.remember(file);
          return { text: `${log}\n\n${describeFile(file)}`, imageUri: dataUri(bytes, 'image/png') };
        }}
      />

      <SectionTitle>From the phone</SectionTitle>
      <Card>
        <Info>
          Files, photos and the camera all end up as a Uint8Array for upload(). The picker re-encodes photos to JPEG so every
          phone and browser can show them.
        </Info>
        <Button title="Pick a file" onPress={pickDocument} secondary />
        <Button title="Pick a photo" onPress={() => pickImage(false)} secondary />
        <Button title="Take a photo" onPress={() => pickImage(true)} secondary />
        <UploadProgressBar progress={pickedProgress} />
        <ResultView state={picked} />
      </Card>
    </View>
  );
}

// ============================================================
// Files
// ============================================================

export function FilesScreen({ openFile }: { openFile: (f: StorageFile) => void }) {
  const model = useModel();
  const t = useTheme();
  const [bucket, setBucket] = useState<TestBucket>('private');
  const [prefix, setPrefix] = useState('');
  const [limit, setLimit] = useState('5');
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [listState, setListState] = useState<ActionState>({ kind: 'idle' });
  const [selected, setSelected] = useState<string[]>([]);
  const [byPath, setByPath] = useState('');
  const bucketName = bucket === 'public' ? model.settings.publicBucket : model.settings.privateBucket;

  const load = async (reset: boolean) => {
    setListState({ kind: 'running' });
    try {
      const page = await model.storage.listFiles(bucketName, {
        prefix: prefix || undefined,
        limit: Number(limit) || undefined,
        cursor: reset ? undefined : cursor,
      });
      setFiles(reset ? page.files : [...files, ...page.files]);
      setCursor(page.nextCursor ?? undefined);
      setListState({ kind: 'success', output: { text: `Page with ${page.files.length} file(s). nextCursor: ${page.nextCursor ?? 'none'}` } });
    } catch (e) {
      setListState({ kind: 'failure', message: describeError(e) });
    }
  };

  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <View>
      <Card>
        <Info>
          listFiles(bucketId, options) returns one page. Filter with a path prefix (a &quot;folder&quot;), choose the page size with
          limit, and pass nextCursor as cursor to get the next page. List follows the bucket&apos;s &quot;list&quot; rule.
        </Info>
        <BucketToggle value={bucket} onChange={setBucket} />
        <Field label="Prefix" value={prefix} onChangeText={setPrefix} placeholder={model.userFolder} />
        <Field label="Page size (limit)" value={limit} onChangeText={setLimit} />
        <Button title="List files" onPress={() => load(true)} />
        <ResultView state={listState} />
      </Card>

      <SectionTitle>{`${files.length} file(s) · tap to open, long-press to select`}</SectionTitle>
      <Card>
        {files.length === 0 ? <Info>Nothing listed yet.</Info> : null}
        {files.map((f) => {
          const isSelected = selected.includes(f.id);
          return (
            <Pressable
              key={f.id}
              onPress={() => openFile(f)}
              onLongPress={() => toggle(f.id)}
              style={{ paddingVertical: 8, borderBottomWidth: 0.5, borderColor: t.border, flexDirection: 'row' }}
            >
              <Text style={{ color: isSelected ? t.accent : t.muted, width: 24 }}>{isSelected ? '●' : '○'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text }} numberOfLines={2}>
                  {f.path}
                </Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>
                  {f.mimeType} · {formatBytes(f.size)}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {cursor ? <Button title="Load more" onPress={() => load(false)} secondary /> : files.length ? <Info>No more pages (no nextCursor).</Info> : null}
      </Card>

      <ActionCard
        title={`deleteMany([${selected.length} selected])`}
        info="Deletes several files in one request and returns how many were deleted. Long-press files above to select them. Each file still follows the bucket's delete rule."
        button="Delete selected"
        destructive
        action={async () => {
          if (!selected.length) throw new Error('Select files first (long-press).');
          const result = await model.storage.deleteMany(selected);
          setFiles(files.filter((f) => !selected.includes(f.id)));
          model.forget(selected);
          const asked = selected.length;
          setSelected([]);
          return `Asked to delete ${asked}, deleted: ${result.deleted}`;
        }}
      />

      <SectionTitle>By path</SectionTitle>
      <ActionCard
        title="getFileByPath(bucketId, path)"
        info="Find a file by its path when you stored the path, not the id."
        action={async () => describeFile(await model.storage.getFileByPath(bucketName, byPath))}
      >
        <Field label="Path" value={byPath} onChangeText={setByPath} placeholder={model.userFolder + 'receipts/رسید-۸۸۱۲.pdf'} />
      </ActionCard>
      <ActionCard
        title="deleteByPath(bucketId, path)"
        info="Delete by path. Follows the delete rule like delete(fileId)."
        button="Delete by path"
        destructive
        action={async () => {
          await model.storage.deleteByPath(bucketName, byPath);
          setFiles(files.filter((f) => f.path !== byPath));
          return `Deleted ${byPath}`;
        }}
      />
    </View>
  );
}

// ============================================================
// One file
// ============================================================

export function FileDetailScreen({ file }: { file: StorageFile }) {
  const model = useModel();
  const t = useTheme();
  const [expiresIn, setExpiresIn] = useState('600');
  const isImage = file.mimeType.startsWith('image/');
  return (
    <View>
      <Card>
        <Text selectable style={[mono, { color: t.text }]}>
          {describeFile(file)}
        </Text>
      </Card>
      <ActionCard title="getFile(fileId)" info="Fresh details of one file by id." action={async () => describeFile(await model.storage.getFile(file.id))} />
      <ActionCard
        title="download(fileId)"
        info="The file's bytes (ArrayBuffer), sent with your key and user token, so it works for private files too. Use it to show or save a private file."
        action={async () => {
          const bytes = new Uint8Array(await model.storage.download(file.id));
          let text = `Downloaded ${bytes.length} bytes (file size ${file.size}).`;
          if (file.mimeType.startsWith('text/')) text += `\n---\n${fromUtf8(bytes.slice(0, 400))}`;
          return { text, imageUri: isImage ? dataUri(bytes, file.mimeType) : undefined };
        }}
      />
      <SectionTitle>Showing and sharing</SectionTitle>
      <ActionCard
        title="Show it the right way"
        info="Public bucket → its public link in <Image>. Private bucket → download() and show the bytes. Never <Image source={{ uri: getUrl(id) }}>: that is an API address that needs the x-api-key header and answers JSON."
        action={async () => {
          if (await model.isPublic(file)) {
            const link = await model.publicLink(file.id);
            return { text: `Public bucket: public link (no headers needed)\n${link}`, imageUri: isImage ? link : undefined, link };
          }
          const bytes = new Uint8Array(await model.storage.download(file.id));
          return { text: `Private bucket: shown from download() (${bytes.length} bytes)`, imageUri: isImage ? dataUri(bytes, file.mimeType) : undefined };
        }}
      />
      <ActionCard
        title="Signed link from your server"
        info="A time-limited link anyone can open until it expires: for sharing, a web view or a video player. Signed links need the server secret, so your server makes them (Node.js SDK getSignedUrl)."
        action={async () => {
          const seconds = Number(expiresIn) || 600;
          const link = await model.signedLink(file.id, seconds);
          const until = new Date(Date.now() + seconds * 1000).toLocaleTimeString();
          return { text: `Valid until about ${until}\n${link}`, imageUri: isImage ? link : undefined, link };
        }}
      >
        <Field label="Expires in (seconds, max 86400)" value={expiresIn} onChangeText={setExpiresIn} />
      </ActionCard>
      <ActionCard
        title="URL helpers (strings only)"
        info="getUrl, getDownloadUrl and getTransformUrl only build API addresses. They need the x-api-key header (and x-user-token where required): load them with fetch or <Image source={{ uri, headers }}>, never as a plain link."
        action={async () =>
          [
            `getUrl: ${model.storage.getUrl(file.id)}`,
            `getDownloadUrl: ${model.storage.getDownloadUrl(file.id)}`,
            `getTransformUrl: ${model.storage.getTransformUrl(file.id, { width: 200 })}`,
          ].join('\n')
        }
      />
      <ActionCard
        title="delete(fileId)"
        info="Deletes the file. Follows the bucket's delete rule."
        button="Delete file"
        destructive
        action={async () => {
          await model.storage.delete(file.id);
          model.forget([file.id]);
          return `Deleted ${file.path}. Go back and list again.`;
        }}
      />
    </View>
  );
}
