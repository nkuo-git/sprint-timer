import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { useCameraPermission } from 'react-native-vision-camera';
import { Text, View } from 'react-native';
import { AccountProvider, useAccount } from './src/account/AccountContext';
import { Account } from './src/screens/Account';
import { History } from './src/screens/History';
import { Home, type Route } from './src/screens/Home';
import { Login } from './src/screens/Login';
import { Nickname } from './src/screens/Nickname';
import { SinglePhone } from './src/screens/SinglePhone';
import { TwoPhoneFinish } from './src/screens/TwoPhoneFinish';
import { TwoPhoneStart } from './src/screens/TwoPhoneStart';
import { Btn, C, s } from './src/ui/kit';

const TIMING: Route[] = ['start', 'finish', 'single'];

export default function App() {
  return (
    <AccountProvider>
      <StatusBar style="light" />
      <Screens />
    </AccountProvider>
  );
}

function Screens() {
  const [route, setRoute] = useState<Route>('home');
  const { hasPermission, requestPermission } = useCameraPermission();
  const { account } = useAccount();
  const back = () => setRoute('home');
  const timing = TIMING.includes(route);

  // 點了登入信的連結回到 App：登入中或登入失敗時帶到登入畫面看狀態（計時畫面進行中不打斷）
  const linkActivity = !account.user && (account.signingIn || !!account.linkError);
  useEffect(() => {
    if (linkActivity) setRoute((r) => (TIMING.includes(r) ? r : 'login'));
  }, [linkActivity]);

  // 第一次登入要先取暱稱（計時畫面進行中不打斷）
  if (account.needsNickname && !timing) return <Nickname onDone={back} />;

  if (timing && !hasPermission) {
    return (
      <View style={[s.screen, s.pad, { justifyContent: 'center' }]}>
        <Text style={s.title}>需要相機權限</Text>
        <Text style={[s.label, { color: C.dim, lineHeight: 24 }]}>用相機偵測衝線和起跑動作，影像只在手機上分析，不會上傳。</Text>
        <Btn big title="允許相機" onPress={() => requestPermission()} />
        <Btn kind="ghost" title="返回" onPress={back} />
      </View>
    );
  }
  switch (route) {
    case 'start':
      return <TwoPhoneStart onBack={back} />;
    case 'finish':
      return <TwoPhoneFinish onBack={back} />;
    case 'single':
      return <SinglePhone onBack={back} />;
    case 'login':
      return account.user ? <Home go={setRoute} /> : <Login onBack={back} onDone={back} />;
    case 'account':
      return account.user ? <Account onBack={back} onHistory={() => setRoute('history')} onEditNickname={() => setRoute('nickname')} /> : <Home go={setRoute} />;
    case 'nickname':
      return account.user ? <Nickname onBack={() => setRoute('account')} onDone={() => setRoute('account')} /> : <Home go={setRoute} />;
    case 'history':
      return <History onBack={back} onLogin={() => setRoute('login')} />;
    default:
      return <Home go={setRoute} />;
  }
}
