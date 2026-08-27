module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['.'],
          alias: { '@': './src' },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
      // react-native-reanimated's plugin (which delegates to
      // react-native-worklets/plugin as of Reanimated v4) MUST be listed
      // last — it needs to run after every other plugin has transformed
      // the source.
      'react-native-reanimated/plugin',
    ],
  };
};
