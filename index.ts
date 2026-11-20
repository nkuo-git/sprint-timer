import { registerRootComponent } from 'expo';

import App from './App';
// 長跑的背景定位任務要在 App 一啟動就定義（螢幕關掉時系統會直接呼叫它）
import './src/run/location';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
