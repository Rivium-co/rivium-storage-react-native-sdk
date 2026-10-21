/** Name this SDK reports in the `X-Rivium-SDK` header. */
export const SDK_NAME = 'react-native';

/** This SDK's version. Must match package.json; test/sdk-header.test.cjs fails when they drift. */
export const SDK_VERSION = '0.2.0';

/** Header naming the SDK on every Rivium Storage API request. */
export const SDK_HEADER = 'X-Rivium-SDK';

/** Value of {@link SDK_HEADER}: `react-native/<version>`. Only the public SDK name and version. */
export const SDK_HEADER_VALUE = `${SDK_NAME}/${SDK_VERSION}`;
