import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { useCameraPermission } from 'react-native-vision-camera';
import { Text, View } from 'react-native';
import { AccountProvider, useAccount } from './src/account/AccountContext';
import { Account } from './src/screens/Account';
import { History } from './src/screens/History';
import { LongRun } from './src/screens/LongRun';
import { RunSummary } from './src/screens/RunSummary';
import { runBests } from './src/records/store';
import { loadKind, saveKind, type Kind } from './src/ui/KindTabs';
import { Home, type Route } from './src/screens/Home';
import { Login } from './src/screens/Login';
import { Nickname } from './src/screens/Nickname';
import { SinglePhone } from './src/screens/SinglePhone';
import { TwoPhoneFinish } from './src/screens/TwoPhoneFinish';
import { TwoPhoneStart } from './src/screens/TwoPhoneStart';
import { Btn, C, s } from './src/ui/kit';

/** 要用相機的計時畫面 */
const TIMING: Route[] = ['start', 'finish', 'single'];
/** 進行中不要被登入連結、取暱稱打斷的畫面 */
const BUSY: Route[] = [...TIMING, 'run'];

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
  const { account, service } = useAccount();
  const back = () => setRoute('home');
  const timing = TIMING.includes(route);
  const busy = BUSY.includes(route);
  // 首頁和我的紀錄的「短跑／長跑」分頁，記得上次停在哪一個
  const [kind, setKindState] = useState<Kind>('sprint');
  useEffect(() => {
    void loadKind().then(setKindState);
  }, []);
  const setKind = (k: Kind) => {
    setKindState(k);
    saveKind(k);
  };
  const [runId, setRunId] = useState<string | null>(null);
  const [runFrom, setRunFrom] = useState<Route>('home');
  const openRun = (from: Route) => (id: string) => {
    setRunId(id);
    setRunFrom(from);
    setRoute('runDetail');
  };

  // 點了登入信的連結回到 App：登入中或登入失敗時帶到登入畫面看狀態（計時畫面進行中不打斷）
  const linkActivity = !account.user && (account.signingIn || !!account.linkError);
  useEffect(() => {
    if (linkActivity) setRoute((r) => (BUSY.includes(r) ? r : 'login'));
  }, [linkActivity]);

  // 第一次登入要先取暱稱（計時畫面進行中不打斷）
  if (account.needsNickname && !busy) return <Nickname onDone={back} />;

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
  const home = <Home go={setRoute} kind={kind} onKind={setKind} openRun={openRun('home')} />;
  switch (route) {
    case 'start':
      return <TwoPhoneStart onBack={back} />;
    case 'finish':
      return <TwoPhoneFinish onBack={back} />;
    case 'single':
      return <SinglePhone onBack={back} />;
    case 'run':
      return <LongRun onBack={back} onHome={back} />;
    case 'runDetail': {
      const uid = account.user?.id ?? null;
      const run = runId ? service.store.run(runId) : undefined;
      if (!run || run.deleted) return home;
      const sameTarget = service.store.runs(uid).filter((r) => r.targetM === run.targetM && r.completed);
      const best = run.targetM !== null && runBests(sameTarget).get(run.targetM)?.id === run.id && sameTarget.length > 1;
      return (
        <RunSummary
          run={run}
          save={!uid || run.owner === null ? 'local' : run.dirty ? 'pending' : 'cloud'}
          personalBest={best}
          onBack={() => setRoute(runFrom)}
          onHome={back}
          onDelete={() => {
            void service.deleteRun(run.id);
            setRoute(runFrom);
          }}
        />
      );
    }
    case 'login':
      return account.user ? home : <Login onBack={back} onDone={back} />;
    case 'account':
      return account.user ? <Account onBack={back} onHistory={() => setRoute('history')} onEditNickname={() => setRoute('nickname')} /> : home;
    case 'nickname':
      return account.user ? <Nickname onBack={() => setRoute('account')} onDone={() => setRoute('account')} /> : home;
    case 'history':
      return <History onBack={back} onLogin={() => setRoute('login')} kind={kind} onKind={setKind} openRun={openRun('history')} />;
    default:
      return home;
  }
}
