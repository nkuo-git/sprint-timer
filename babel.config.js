module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // frame processor（'worklet' 函式）需要這個 plugin，且必須放最後
    plugins: ['react-native-worklets/plugin'],
  };
};
