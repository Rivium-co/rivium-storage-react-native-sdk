import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { StorageFile } from '@rivium/storage-react-native';
import { ExampleModel, ModelProvider } from './src/model';
import { loadSettings } from './src/config';
import { useTheme } from './src/ui';
import { BucketsScreen, HomeScreen, SCREEN_TITLES, ScreenName, SetupScreen, SignInScreen } from './src/screens/StartScreens';
import { FileDetailScreen, FilesScreen, UploadScreen } from './src/screens/FileScreens';
import { ImagesScreen, TransformsScreen } from './src/screens/ImageScreens';
import { ErrorsScreen } from './src/screens/ErrorsScreen';
import { SelfTestScreen } from './src/screens/SelfTestScreen';

/**
 * Rivium Storage React Native example: every SDK feature in its own screen,
 * each with a short explanation and the visible result or exact error.
 *
 * The SDK comes from this repository's source (../src, see metro.config.js),
 * so unreleased SDK changes are what runs, in debug and release builds.
 */

type Route = { name: ScreenName } | { name: 'file'; file: StorageFile };

export default function App() {
  const [model, setModel] = useState<ExampleModel | null>(null);

  useEffect(() => {
    // Settings from .env (build time), or the edits saved on this phone.
    loadSettings().then(async (settings) => {
      const m = new ExampleModel();
      await m.updateSettings(settings);
      setModel(m);
    });
  }, []);

  if (!model) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return (
    <ModelProvider model={model}>
      <Navigator />
    </ModelProvider>
  );
}

function Navigator() {
  const t = useTheme();
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const route = stack[stack.length - 1];
  const push = (r: Route) => setStack([...stack, r]);
  const back = () => setStack(stack.length > 1 ? stack.slice(0, -1) : stack);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  });

  const title = route.name === 'file' ? route.file.fileName : SCREEN_TITLES[route.name];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        {stack.length > 1 ? (
          <Pressable onPress={back} hitSlop={12} style={{ marginRight: 12 }}>
            <Text style={{ color: t.accent, fontSize: 17 }}>‹ Back</Text>
          </Pressable>
        ) : null}
        <Text numberOfLines={1} style={{ color: t.text, fontSize: stack.length > 1 ? 18 : 28, fontWeight: '700', flex: 1 }}>
          {title}
        </Text>
      </View>
      {/* Screens under the top one stay mounted (hidden), so going back keeps their state. */}
      {stack.map((r, i) => (
        <ScrollView
          key={i}
          style={i === stack.length - 1 ? { flex: 1 } : { display: 'none' }}
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
        >
          <Screen route={r} push={push} />
        </ScrollView>
      ))}
    </SafeAreaView>
  );
}

function Screen({ route, push }: { route: Route; push: (r: Route) => void }) {
  switch (route.name) {
    case 'home':
      return <HomeScreen open={(name) => push({ name })} />;
    case 'setup':
      return <SetupScreen />;
    case 'signin':
      return <SignInScreen />;
    case 'selftest':
      return <SelfTestScreen />;
    case 'buckets':
      return <BucketsScreen />;
    case 'upload':
      return <UploadScreen />;
    case 'files':
      return <FilesScreen openFile={(file) => push({ name: 'file', file })} />;
    case 'file':
      return <FileDetailScreen file={route.file} />;
    case 'images':
      return <ImagesScreen />;
    case 'transforms':
      return <TransformsScreen />;
    case 'errors':
      return <ErrorsScreen />;
  }
}
