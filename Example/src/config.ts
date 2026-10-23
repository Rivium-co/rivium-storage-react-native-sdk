import * as FileSystem from 'expo-file-system';

/**
 * Values the example needs. They start from Example/.env (EXPO_PUBLIC_*,
 * baked in at build time, git-ignored) and can be changed on the phone in
 * Setup; those edits are saved on that phone only.
 */
export interface ExampleSettings {
  apiKey: string;
  tokenUrl: string;
  signedUrlEndpoint: string;
  publicBucket: string;
  privateBucket: string;
  testUserId: string;
}

// Expo inlines process.env.EXPO_PUBLIC_* only when written out like this.
export function settingsFromBuild(): ExampleSettings {
  return {
    apiKey: process.env.EXPO_PUBLIC_RIVIUM_API_KEY ?? '',
    tokenUrl: process.env.EXPO_PUBLIC_RIVIUM_TOKEN_URL ?? '',
    signedUrlEndpoint: process.env.EXPO_PUBLIC_RIVIUM_SIGNED_URL_ENDPOINT ?? '',
    publicBucket: process.env.EXPO_PUBLIC_RIVIUM_PUBLIC_BUCKET || 'rivium-example-public',
    privateBucket: process.env.EXPO_PUBLIC_RIVIUM_PRIVATE_BUCKET || 'rivium-example-private-images',
    testUserId: process.env.EXPO_PUBLIC_RIVIUM_TEST_USER_ID || 'demo-user',
  };
}

export function hasRealApiKey(s: ExampleSettings): boolean {
  return s.apiKey.startsWith('rv_') && !s.apiKey.includes('xxxx');
}

const FILE = `${FileSystem.documentDirectory ?? ''}rivium-storage-example-settings.json`;

interface Saved {
  build: ExampleSettings;
  settings: ExampleSettings;
}

/** Edits made on the phone win until the build values change (a new .env). */
export async function loadSettings(): Promise<ExampleSettings> {
  const build = settingsFromBuild();
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return build;
    const saved: Saved = JSON.parse(await FileSystem.readAsStringAsync(FILE));
    return JSON.stringify(saved.build) === JSON.stringify(build) ? saved.settings : build;
  } catch (e) {
    console.warn('[example] could not read saved settings, using the build values:', e);
    return build;
  }
}

export async function saveSettings(settings: ExampleSettings): Promise<void> {
  const saved: Saved = { build: settingsFromBuild(), settings };
  await FileSystem.writeAsStringAsync(FILE, JSON.stringify(saved));
}
