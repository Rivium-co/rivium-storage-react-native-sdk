// Metro config for the Rivium Storage React Native example.
//
// The example must run the SDK SOURCE in this repository (../src), never the
// published npm package and never a stale ../dist build: we use it to test
// unreleased SDK changes on phones, in debug AND release builds.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const sdkRoot = path.resolve(__dirname, '..');
const sdkEntry = path.join(sdkRoot, 'src', 'index.ts');
const SDK_PACKAGE = '@rivium/storage-react-native';

// Watch the SDK source so edits reload the app.
config.watchFolders = [sdkRoot];

// Resolve every module from the example's node_modules first (one React, one
// React Native).
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(sdkRoot, 'node_modules'),
];

// "@rivium/storage-react-native" -> ../src/index.ts
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === SDK_PACKAGE) {
    return { type: 'sourceFile', filePath: sdkEntry };
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
