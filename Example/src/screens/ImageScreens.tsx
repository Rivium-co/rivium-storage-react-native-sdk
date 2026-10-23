import React, { useState } from 'react';
import { ActivityIndicator, Image, Text, View } from 'react-native';
import { ImageTransforms, StorageFile } from '@rivium/storage-react-native';
import { fetchBytes, fetchTransform, loadPublicImage, PublicImageLoad, TransformRefusal, useModel, withBusyRetry } from '../model';
import { Samples } from '../samples';
import { dataUri, fromUtf8 } from '../bytes';
import {
  ActionCard,
  Button,
  Card,
  Field,
  Info,
  RecentFilePicker,
  ResultImage,
  SectionTitle,
  Segmented,
  describeError,
  mono,
  styles,
  useTheme,
} from '../ui';

// ============================================================
// Showing images and links
// ============================================================

export function ImagesScreen() {
  const model = useModel();
  const t = useTheme();
  const [publicImage, setPublicImage] = useState<StorageFile | null>(null);
  const [privateImage, setPrivateImage] = useState<StorageFile | null>(null);
  const [expiresIn, setExpiresIn] = useState('120');

  const need = (f: StorageFile | null) => {
    if (!f) throw new Error('Tap "Upload demo images" first.');
    return f;
  };
  const wrong = publicImage ?? privateImage;

  return (
    <View>
      <Card>
        <Text style={{ color: t.text, lineHeight: 20 }}>
          Which link to use:{'\n'}• Public bucket → ask once for the file&apos;s public link and use it anywhere.{'\n'}• Private
          bucket → download() in the app (sends your key and user token), or a signed link made by your server.{'\n'}•
          Never {'<Image source={{ uri: storage.getUrl(id) }} />'}: that is an API address. It needs the x-api-key header and
          answers JSON, not the image.
        </Text>
      </Card>

      <SectionTitle>1. Prepare one image in each bucket</SectionTitle>
      <ActionCard
        title="Upload demo images"
        info="Uploads a PNG to the public bucket and one to your folder in the private bucket."
        action={async () => {
          const pub = await model.storage.upload(model.settings.publicBucket, model.userFolder + `public-${Samples.stamp()}.png`, Samples.png(), { contentType: 'image/png' });
          const priv = await model.storage.upload(model.settings.privateBucket, model.userFolder + `private-${Samples.stamp()}.png`, Samples.png(), { contentType: 'image/png' });
          model.remember(pub);
          model.remember(priv);
          setPublicImage(pub);
          setPrivateImage(priv);
          return `Public: ${pub.path}\nPrivate: ${priv.path}`;
        }}
      />

      <SectionTitle>2. Public bucket: public link</SectionTitle>
      <ActionCard
        title="GET getUrl(fileId) with the key → { url }"
        info="getUrl returns the API address; one request with the x-api-key header returns the public link, which needs no headers. A private bucket answers 403 here."
        action={async () => {
          const link = await model.publicLink(need(publicImage).id);
          return { text: `Public link:\n${link}`, imageUri: link, link };
        }}
      />

      <SectionTitle>3. Private bucket: download()</SectionTitle>
      <ActionCard
        title="download(fileId) → data: URI → <Image>"
        info="The SDK sends your key and user token, so access rules apply to the signed-in user. Best for private photos you show inside the app."
        action={async () => {
          const bytes = new Uint8Array(await model.storage.download(need(privateImage).id));
          return { text: `${bytes.length} bytes from download()`, imageUri: dataUri(bytes, 'image/png') };
        }}
      />

      <SectionTitle>4. Private bucket: signed link</SectionTitle>
      <ActionCard
        title="Signed link from your server"
        info="Your server calls getSignedUrl(fileId, { expiresIn }) with the server secret and returns the link. It works without headers until it expires: good for sharing, or for players that load a URL."
        action={async () => {
          const seconds = Number(expiresIn) || 120;
          const link = await model.signedLink(need(privateImage).id, seconds);
          const loaded = await fetchBytes(link); // no headers, like a browser
          const until = new Date(Date.now() + seconds * 1000).toLocaleTimeString();
          return { text: `Loaded ${loaded.bytes.length} bytes WITHOUT headers (HTTP ${loaded.status}). Valid until about ${until}.\n${link}`, imageUri: link, link };
        }}
      >
        <Field label="Expires in (seconds)" value={expiresIn} onChangeText={setExpiresIn} />
      </ActionCard>

      <SectionTitle>5. The wrong way (on purpose)</SectionTitle>
      {wrong ? (
        <Card>
          <Text style={[mono, { color: t.text }]}>{`<Image source={{ uri: getUrl("${wrong.id.slice(0, 8)}…") }} /> fails:`}</Text>
          <ResultImage source={{ uri: model.storage.getUrl(wrong.id) }} />
          <ActionCard
            title="Why it fails"
            info="Loads the same address with no headers, as <Image> does, and shows the server's answer."
            action={async () => {
              try {
                const r = await fetchBytes(model.storage.getUrl(wrong.id));
                return `HTTP ${r.status}, ${r.contentType}: ${fromUtf8(r.bytes.slice(0, 300))}\nEven when it answers, it is JSON, not an image.`;
              } catch (e) {
                return `Without headers the API refuses it:\n${describeError(e)}`;
              }
            }}
          />
        </Card>
      ) : (
        <Info>Upload the demo images first.</Info>
      )}
    </View>
  );
}

// ============================================================
// Transforms
// ============================================================

const FITS = ['cover', 'contain', 'fill', 'inside', 'outside'] as const;
const FORMATS = ['original', 'jpeg', 'png', 'webp', 'avif'] as const;
const ROTATIONS = ['0', '90', '180', '270'] as const;

export function TransformsScreen() {
  const model = useModel();
  const t = useTheme();
  const [fileId, setFileId] = useState('');
  const [width, setWidth] = useState('300');
  const [height, setHeight] = useState('200');
  const [fit, setFit] = useState<(typeof FITS)[number]>('cover');
  const [format, setFormat] = useState<(typeof FORMATS)[number]>('webp');
  const [quality, setQuality] = useState('80');
  const [blur, setBlur] = useState('0');
  const [sharpen, setSharpen] = useState('0');
  const [rotate, setRotate] = useState<(typeof ROTATIONS)[number]>('0');

  const num = (s: string) => (Number(s) > 0 ? Number(s) : undefined);
  const transforms: ImageTransforms = {
    width: num(width),
    height: num(height),
    fit,
    format: format === 'original' ? undefined : format,
    quality: num(quality),
    blur: num(blur),
    sharpen: num(sharpen),
    rotate: num(rotate),
  };
  // getTransformUrl checks the options (invalid_transform): show the problem instead of failing the render.
  let url: string;
  try {
    url = model.storage.getTransformUrl(fileId || '<fileId>', transforms);
  } catch (e) {
    url = describeError(e);
  }

  const preset = (p: Partial<Record<'w' | 'h' | 'q' | 'blur' | 'sharpen', string>>, f: typeof fit, fmt: typeof format) => {
    setWidth(p.w ?? '');
    setHeight(p.h ?? '');
    setQuality(p.q ?? '');
    setBlur(p.blur ?? '0');
    setSharpen(p.sharpen ?? '0');
    setFit(f);
    setFormat(fmt);
    setRotate('0');
  };

  return (
    <View>
      <Info>
        getTransformUrl(fileId, transforms) builds the address of a resized / converted copy, made on request. It follows the
        bucket&apos;s read rules and needs the x-api-key header (and x-user-token where required), so pass headers to
        &lt;Image&gt; or fetch it.
      </Info>
      <Card>
        <RecentFilePicker label="Image file" fileId={fileId} onChange={setFileId} imagesOnly />
      </Card>
      <ActionCard
        title="Upload a sample image"
        info="A 240×160 PNG in your private folder, ready to transform."
        action={async () => {
          const file = await model.storage.upload(model.settings.privateBucket, model.userFolder + `transform-${Samples.stamp()}.png`, Samples.png(), { contentType: 'image/png' });
          model.remember(file);
          setFileId(file.id);
          return `Uploaded ${file.path}`;
        }}
      />

      <SectionTitle>Options</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="width (w, ≤4096)" value={width} onChangeText={setWidth} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="height (h, ≤4096)" value={height} onChangeText={setHeight} />
          </View>
        </View>
        <Text style={{ color: t.muted, fontSize: 12 }}>fit</Text>
        <Segmented options={FITS.map((v) => ({ value: v, label: v }))} value={fit} onChange={setFit} />
        <Text style={{ color: t.muted, fontSize: 12 }}>format (f)</Text>
        <Segmented options={FORMATS.map((v) => ({ value: v, label: v }))} value={format} onChange={setFormat} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="quality (q, 1-100)" value={quality} onChangeText={setQuality} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="blur (0-20)" value={blur} onChangeText={setBlur} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="sharpen (0-10)" value={sharpen} onChangeText={setSharpen} />
          </View>
        </View>
        <Text style={{ color: t.muted, fontSize: 12 }}>rotate</Text>
        <Segmented options={ROTATIONS.map((v) => ({ value: v, label: v }))} value={rotate} onChange={setRotate} />
        <Text style={{ color: t.muted, fontSize: 12 }}>Presets</Text>
        <Segmented
          options={[
            { value: 'thumb', label: 'Thumbnail 120 webp' },
            { value: 'blur', label: 'Blurred background' },
          ]}
          value={'' as 'thumb' | 'blur'}
          onChange={(v) => (v === 'thumb' ? preset({ w: '120', h: '120', q: '70' }, 'cover', 'webp') : preset({ w: '600', q: '60', blur: '20' }, 'inside', 'jpeg'))}
        />
        <Text selectable style={[mono, { color: t.text }]}>
          {url}
        </Text>
      </Card>

      <ActionCard
        title="<Image source={{ uri, headers }}> (the documented way)"
        info="React Native's <Image> can send headers, so the transform address works directly."
        action={async () => {
          if (!fileId) throw new Error('Pick or upload an image first.');
          return { text: 'Loaded by <Image> with x-api-key (and x-user-token when signed in):', imageWithHeaders: { uri: url, headers: model.riviumHeaders() } };
        }}
      />
      <ActionCard
        title="fetch with headers → show type and size"
        info="The same address with fetch, to see what the server returns (type, bytes)."
        action={async () => {
          if (!fileId) throw new Error('Pick or upload an image first.');
          // A refusal reads code + message from the JSON body: a title and a hint, never the raw body.
          const r = await fetchTransform(url, model.riviumHeaders());
          return { text: `${r.contentType} · ${r.bytes.length} bytes`, imageUri: dataUri(r.bytes, r.contentType.split(';')[0]) };
        }}
      />

      <PublicImageLinkCard transforms={transforms} />
    </View>
  );
}

type PublicState =
  | { kind: 'idle' }
  | { kind: 'running'; note?: string }
  | { kind: 'success'; url: string; load: PublicImageLoad; busy?: string }
  | { kind: 'failure'; title?: string; message: string };

/**
 * Public bucket: header-free link. getPublicUrl(publicFileId, options) → <Image source={{ uri }}> with NO headers.
 * The URL is loaded once without headers first, so a refusal shows its title, message and hint (an <Image> can't).
 */
function PublicImageLinkCard({ transforms }: { transforms: ImageTransforms }) {
  const model = useModel();
  const t = useTheme();
  const [publicFileId, setPublicFileId] = useState('');
  const [state, setState] = useState<PublicState>({ kind: 'idle' });

  const run = async () => {
    setState({ kind: 'running' });
    try {
      let id = publicFileId;
      if (!id) {
        const file = await model.storage.upload(model.settings.publicBucket, model.userFolder + `public-transform-${Samples.stamp()}.png`, Samples.png(), { contentType: 'image/png' });
        model.remember(file);
        setPublicFileId(file.id);
        id = file.id;
      }
      // invalid_transform before any request; 403 when the bucket is private.
      const url = await model.storage.getPublicUrl(id, transforms);
      let busy: string | undefined;
      const load = await withBusyRetry(
        () => loadPublicImage(url),
        (seconds) => {
          busy = `Busy, retried after ${seconds} s (Retry-After)`;
          setState({ kind: 'running', note: `Busy, retrying… (in ${seconds} s, as Retry-After says)` });
        },
      );
      setState({ kind: 'success', url, load, busy });
    } catch (e) {
      setState({ kind: 'failure', title: e instanceof TransformRefusal ? e.title : undefined, message: describeError(e) });
    }
  };

  return (
    <Card>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>Public bucket: header-free link</Text>
      <Info>
        getPublicUrl(publicFileId, options) with the options above returns the public link with them
        (…/public/&lt;bucketId&gt;/&lt;path&gt;?w=300&amp;f=webp). It goes straight into {'<Image source={{ uri }} />'}: no
        headers, and the CDN caches it. Use a few fixed sizes: one image keeps at most 50 variants (option combinations);
        a new one beyond that is refused (429 too_many_variants).
      </Info>
      <Field label="Public image file id (empty: upload a sample to the public bucket)" value={publicFileId} onChangeText={setPublicFileId} placeholder="file id" />
      <Button title="Show the public image link" onPress={run} disabled={state.kind === 'running'} />
      {state.kind === 'running' ? (
        <View style={styles.row}>
          <ActivityIndicator />
          <Text style={{ color: t.muted, marginLeft: 8 }}>{state.note ?? 'Running…'}</Text>
        </View>
      ) : null}
      {state.kind === 'failure' ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ color: t.red, fontWeight: '700' }}>Error</Text>
          {state.title ? <Text style={{ color: t.red, fontWeight: '700', fontSize: 16, marginTop: 2 }}>{state.title}</Text> : null}
          <Text selectable style={[mono, { color: t.red }]}>
            {state.message}
          </Text>
        </View>
      ) : null}
      {state.kind === 'success' ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ color: t.green, fontWeight: '700' }}>Success</Text>
          <Text selectable style={[mono, { color: t.text }]}>
            {`${state.load.contentType} · ${state.load.bytes} B · X-Transform-Cache: ${state.load.cache ?? '-'}${state.busy ? `\n${state.busy}` : ''}\nNo headers sent.\n${state.url}`}
          </Text>
          {/* The native image view, with only the URL: no x-api-key, no user token. */}
          <Image source={{ uri: state.url }} style={styles.image} resizeMode="contain" />
        </View>
      ) : null}
    </Card>
  );
}
