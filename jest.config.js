module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: [
    './node_modules/react-native-gesture-handler/jestSetup.js',
  ],
  moduleNameMapper: {
    '^react-native-vector-icons/(.*)$': '<rootDir>/__mocks__/iconStub.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-reanimated|react-native-gesture-handler|react-native-vector-icons|react-native-worklets|react-native-safe-area-context)/)',
  ],
};
