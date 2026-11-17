import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Btn, Label, s } from '../ui/kit';

export type Route = 'home' | 'start' | 'finish' | 'single';

export function Home({ go }: { go(r: Route): void }) {
  return (
    <ScrollView contentContainerStyle={[s.pad, { paddingTop: 64 }]} style={s.screen}>
      <Text style={[s.title, { fontSize: 28 }]}>短跑計時</Text>
      <Label dim>成績 = 衝線時間 − 鳴槍時間（含反應時間，和正式比賽一樣）</Label>
      <View style={s.card}>
        <Text style={s.title}>雙手機（最準）</Text>
        <Label dim>一支放起跑線發令，一支放終點用高速相機抓衝線。兩支手機需連同一個 Wi-Fi 或熱點。</Label>
        <Btn title="這支是起跑手機" onPress={() => go('start')} />
        <Btn title="這支是終點手機" onPress={() => go('finish')} />
      </View>
      <View style={s.card}>
        <Text style={s.title}>單手機</Text>
        <Label dim>手機放終點，自己鳴槍（自動扣除聲音傳遞時間）或閃光起跑。</Label>
        <Btn title="單手機模式" onPress={() => go('single')} />
      </View>
    </ScrollView>
  );
}
