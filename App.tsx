import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { useCameraPermission } from 'react-native-vision-camera';
import { Text, View } from 'react-native';
import { Home, type Route } from './src/screens/Home';
import { SinglePhone } from './src/screens/SinglePhone';
import { TwoPhoneFinish } from './src/screens/TwoPhoneFinish';
import { TwoPhoneStart } from './src/screens/TwoPhoneStart';
import { Btn, s } from './src/ui/kit';

export default function App() {
  const [route, setRoute] = useState<Route>('home');
  const { hasPermission, requestPermission } = useCameraPermission();
  const back = () => setRoute('home');

  let body: React.ReactNode;
  if (route !== 'home' && !hasPermission) {
    body = (
      <View style={[s.screen, s.pad, { justifyContent: 'center' }]}>
        <Text style={s.label}>需要相機權限才能偵測衝線 / 起跑動作</Text>
        <Btn title="允許相機" onPress={() => requestPermission()} />
        <Btn kind="ghost" title="返回" onPress={back} />
      </View>
    );
  } else if (route === 'start') body = <TwoPhoneStart onBack={back} />;
  else if (route === 'finish') body = <TwoPhoneFinish onBack={back} />;
  else if (route === 'single') body = <SinglePhone onBack={back} />;
  else body = <Home go={setRoute} />;

  return (
    <>
      <StatusBar style="light" />
      {body}
    </>
  );
}
