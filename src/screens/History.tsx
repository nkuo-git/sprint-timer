import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useAccount } from '../account/AccountContext';
import { clockLabel, dayLabel, distanceLabel, groupByDay, initial, modeLabel, retag } from '../records/format';
import { personalBests, runBests } from '../records/store';
import { decodePolyline } from '../core/gpsTrack';
import { averagePace, durationLabel, kmLabel, paceLabel, targetLabel } from '../run/format';
import { KindTabs, type Kind } from '../ui/KindTabs';
import { RouteThumb } from '../ui/RouteMap';
import type { StoredRun } from '../records/types';
import type { MyResult, StoredRace, StoredResult } from '../records/types';
import { Avatar, Btn, C, Chip, Header, NUM, s } from '../ui/kit';
import { PickRunner } from '../ui/PickRunner';
import { syncSummary } from './Account';

type Tab = 'mine' | 'timed';

/** 設計稿「31 我的紀錄」：短跑（我的成績／我計時的比賽）、長跑兩個分頁 */
export function History({ onBack, onLogin, kind, onKind, openRun }: { onBack(): void; onLogin(): void; kind: Kind; onKind(k: Kind): void; openRun(id: string): void }) {
  const { account, service } = useAccount();
  const uid = account.user?.id ?? null;
  const [tab, setTab] = useState<Tab>('mine');
  const [distance, setDistance] = useState<number | null>(null);
  const [picking, setPicking] = useState<{ race: StoredRace; result: StoredResult } | null>(null);

  // 進來時同步一次；離開時把「新」的標示清掉
  useEffect(() => {
    void service.refresh();
    return () => {
      void service.markTaggedSeen();
    };
  }, [service]);

  const mine = useMemo(() => service.store.myResults(uid), [service, uid, account.recordsRev]);
  const races = useMemo(() => service.store.races().filter((r) => r.owner === null || r.owner === uid), [service, uid, account.recordsRev]);
  const bests = useMemo(() => personalBests(mine), [mine]);
  const distances = useMemo(() => [...new Set(mine.map((m) => m.distanceM).filter((d): d is number => d !== null))].sort((a, b) => a - b), [mine]);
  const shown = distance === null ? mine : mine.filter((m) => m.distanceM === distance);
  const best = distance !== null ? bests.get(distance) : undefined;
  const sync = syncSummary(account);
  const runList = useMemo(() => service.store.runs(uid), [service, uid, account.recordsRev]);

  const removeTagged = (m: MyResult) =>
    Alert.alert('從我的紀錄移除？', `${m.timedBy?.nickname ?? '對方'}幫你計時的這筆 ${m.official.toFixed(2)} 會從你的紀錄消失，對方那邊仍會保留。`, [
      { text: '取消', style: 'cancel' },
      { text: '移除', style: 'destructive', onPress: () => void service.untag(m.resultId).catch(() => undefined) },
    ]);

  const removeRace = (r: StoredRace) =>
    Alert.alert('刪除這一趟？', '這一趟所有跑者的成績都會刪除，被標記的人也不會再看到。', [
      { text: '取消', style: 'cancel' },
      { text: '刪除', style: 'destructive', onPress: () => void service.deleteRace(r.id) },
    ]);

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.pad, { gap: 14, flexGrow: 1 }]}>
        <Header
          onBack={onBack}
          title={uid ? '我的紀錄' : '這支手機上的紀錄'}
          right={uid ? <Chip dot tone={sync.tone === 'bad' ? 'bad' : sync.tone === 'warn' ? 'neutral' : 'info'} text={account.pending > 0 ? `${account.pending} 筆待上傳` : sync.title.replace('雲端', '')} /> : undefined}
        />

        <KindTabs value={kind} onChange={onKind} />
        {kind === 'sprint' ? (
          <View accessibilityRole="tablist" style={[s.row, { gap: 20, borderBottomWidth: 1, borderBottomColor: C.raised }]}>
            <TabBtn title="我的成績" on={tab === 'mine'} onPress={() => setTab('mine')} />
            <TabBtn title="我計時的比賽" on={tab === 'timed'} onPress={() => setTab('timed')} />
          </View>
        ) : null}

        {!uid && account.cloudEnabled ? (
          <Pressable accessibilityRole="button" onPress={onLogin} style={({ pressed }) => [{ backgroundColor: C.infoBg, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 }, pressed && { opacity: 0.8 }]}>
            <Text style={{ color: '#C5DFF7', fontSize: 14, lineHeight: 22 }}>這些紀錄只存在這支手機。登入後會存到雲端，換手機也帶得走。</Text>
            <Text style={{ color: C.infoText, fontSize: 15, fontWeight: '700', paddingTop: 4 }}>用 Email 登入 ›</Text>
          </Pressable>
        ) : null}

        {kind === 'long' ? (
          <LongRuns runs={runList} onOpen={openRun} />
        ) : tab === 'mine' ? (
          <>
            {distances.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
                <FilterChip title="全部" on={distance === null} onPress={() => setDistance(null)} />
                {distances.map((d) => (
                  <FilterChip key={d} title={distanceLabel(d)} on={distance === d} onPress={() => setDistance(d)} />
                ))}
              </ScrollView>
            ) : null}

            {best ? (
              <View style={[s.card, s.row, { borderRadius: 18, justifyContent: 'space-between' }]}>
                <View style={{ gap: 4, flex: 1 }}>
                  <View style={{ alignSelf: 'flex-start', backgroundColor: C.warn, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
                    <Text style={{ color: C.onAccent, fontSize: 13, fontWeight: '700' }}>{distanceLabel(distance)} 個人最佳</Text>
                  </View>
                  <Text style={{ color: C.dim, fontSize: 13 }}>
                    {dayLabel(best.ranAt).replace('今天 · ', '')} · {modeLabel(best.mode)} · 共 {shown.length} 趟
                  </Text>
                </View>
                <Text style={[NUM, { color: C.accent, fontSize: 48, fontWeight: '700', lineHeight: 52 }]}>{best.official.toFixed(2)}</Text>
              </View>
            ) : null}

            {shown.length === 0 ? (
              <Text style={{ color: C.dim, fontSize: 15, lineHeight: 24, paddingVertical: 12 }}>
                還沒有成績。跑完之後在成績畫面把那一筆標記成「我自己」，就會出現在這裡。{uid ? '別人幫你計時並標記給你的成績也會自動出現。' : ''}
              </Text>
            ) : null}
            <View>
              {groupByDay(shown).map((g) => (
                <View key={g.key}>
                  <Text style={{ color: C.soft, fontSize: 14, fontWeight: '700', paddingTop: 14, paddingBottom: 6 }}>{dayLabel(g.items[0].ranAt)}</Text>
                  {g.items.map((m) => {
                    const isBest = m.distanceM !== null && bests.get(m.distanceM)?.key === m.key;
                    const title = `${distanceLabel(m.distanceM)}${(m.runners ?? 2) > 1 ? ` · 第 ${m.place} 名` : ''}`;
                    const detail = m.timedBy
                      ? `${m.timedBy.nickname ?? '其他用戶'}幫你計時`
                      : `${modeLabel(m.mode)}${m.reaction !== undefined ? ` · 反應 ${m.reaction.toFixed(3)}` : ' · 自己計時'}`;
                    return (
                      <Pressable
                        key={m.key}
                        disabled={!m.timedBy}
                        onLongPress={() => removeTagged(m)}
                        accessibilityHint={m.timedBy ? '長按可以從我的紀錄移除' : undefined}
                        style={[s.row, { gap: 12, minHeight: 64, borderTopWidth: 1, borderTopColor: C.raised }]}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={[s.row, { gap: 8 }]}>
                            <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>{title}</Text>
                            {m.isNew ? (
                              <View style={{ backgroundColor: C.info, borderRadius: 999, paddingVertical: 1, paddingHorizontal: 8 }}>
                                <Text style={{ color: C.onAccent, fontSize: 12, fontWeight: '700' }}>新</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={{ color: m.timedBy ? C.infoText : C.dim, fontSize: 13 }}>
                            {clockLabel(m.ranAt)} · {detail}
                          </Text>
                        </View>
                        <Text style={[NUM, { color: m.falseStart ? C.badText : isBest ? C.accent : C.text, fontSize: 26, fontWeight: '700' }]}>{m.falseStart ? '搶跑' : m.official.toFixed(2)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
            {shown.some((m) => m.timedBy) ? <Text style={s.note}>別人幫你計時的成績，長按可以從你的紀錄移除。</Text> : null}
          </>
        ) : (
          <>
            <Text style={{ color: C.dim, fontSize: 14, lineHeight: 22 }}>
              {uid ? '用這個帳號計時的每一趟。標記給別人的成績，會自動出現在對方的紀錄裡。' : '用這支手機計時的每一趟。'}點跑者可以補標記，長按標題可以刪除整趟。
            </Text>
            {races.length === 0 ? <Text style={{ color: C.dim, fontSize: 15, paddingVertical: 12 }}>還沒有計時過的比賽。</Text> : null}
            {races.map((race) => (
              <View key={race.id} style={[s.card, { borderRadius: 18, paddingVertical: 14, gap: 4 }]}>
                <Pressable onLongPress={() => removeRace(race)} accessibilityHint="長按可以刪除這一趟" style={[s.row, { justifyContent: 'space-between', paddingBottom: 6 }]}>
                  <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>
                    {distanceLabel(race.distanceM)} · {race.results.length} 位跑者
                  </Text>
                  <Text style={{ color: C.dim, fontSize: 13 }}>
                    {dayLabel(race.ranAt).split(' · ')[0]} {clockLabel(race.ranAt)}
                    {race.dirty && uid ? ' · 待上傳' : ''}
                  </Text>
                </Pressable>
                {race.results.map((r) => {
                  const runner = r.runner;
                  const name = !runner ? `跑者 ${r.place}（未標記）` : runner.kind === 'self' ? `${account.nickname ?? '我'}（我）` : runner.kind === 'user' ? runner.nickname : runner.name;
                  return (
                    <Pressable
                      key={r.id}
                      accessibilityRole="button"
                      accessibilityLabel={`第 ${r.place} 位 ${name}，點一下標記`}
                      onPress={() => setPicking({ race, result: r })}
                      style={({ pressed }) => [s.row, { gap: 10, minHeight: 48, borderTopWidth: 1, borderTopColor: C.raised }, pressed && { opacity: 0.7 }]}
                    >
                      <Text style={[NUM, { width: 20, color: C.dim, fontSize: 16, fontWeight: '700' }]}>{r.place}</Text>
                      <Avatar label={!runner ? '?' : runner.kind === 'self' ? initial(account.nickname ?? '我') : initial(name)} size={28} tone={!runner || runner.kind === 'name' ? 'none' : runner.kind === 'self' ? 'me' : 'user'} />
                      <Text style={{ color: runner ? C.text : C.dim, fontSize: 15, flex: 1 }} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text style={[NUM, { color: r.falseStart ? C.badText : C.text, fontSize: 20, fontWeight: '700' }]}>{r.falseStart ? '搶跑' : r.official.toFixed(2)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <PickRunner
        target={picking ? { place: picking.result.place, official: picking.result.official, distanceM: picking.race.distanceM, current: picking.result.runner } : null}
        onClose={() => setPicking(null)}
        onPick={(runner) => {
          if (picking) void service.saveRace(retag(picking.race, picking.result.id, runner));
          setPicking(null);
        }}
      />
    </View>
  );
}

/** 短跑底下的分頁：底線樣式，和上面的「短跑／長跑」分得出層級 */
function TabBtn({ title, on, onPress }: { title: string; on: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [{ minHeight: 48, justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: on ? C.accent : 'transparent', paddingHorizontal: 2 }, pressed && { opacity: 0.7 }]}
    >
      <Text style={{ color: on ? C.text : C.dim, fontSize: 16, fontWeight: '700' }}>{title}</Text>
    </Pressable>
  );
}

/** 長跑分頁：依目標距離篩選、個人最佳、每次一列（路線縮圖） */
function LongRuns({ runs, onOpen }: { runs: StoredRun[]; onOpen(id: string): void }) {
  const [filter, setFilter] = useState<number | 'free' | null>(null);
  const targets = useMemo(() => [...new Set(runs.map((r) => r.targetM).filter((t): t is number => t !== null))].sort((a, b) => a - b), [runs]);
  const hasFree = runs.some((r) => r.targetM === null);
  const shown = filter === null ? runs : filter === 'free' ? runs.filter((r) => r.targetM === null) : runs.filter((r) => r.targetM === filter);
  const bests = useMemo(() => runBests(runs), [runs]);
  const best = typeof filter === 'number' ? bests.get(filter) : undefined;
  const bestCount = typeof filter === 'number' ? runs.filter((r) => r.targetM === filter && r.completed).length : 0;
  return (
    <>
      {targets.length + (hasFree ? 1 : 0) > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
          <FilterChip title="全部" on={filter === null} onPress={() => setFilter(null)} />
          {targets.map((t) => (
            <FilterChip key={t} title={targetLabel(t)} on={filter === t} onPress={() => setFilter(t)} />
          ))}
          {hasFree ? <FilterChip title="自由跑" on={filter === 'free'} onPress={() => setFilter('free')} /> : null}
        </ScrollView>
      ) : null}

      {best ? (
        <View style={[s.card, s.row, { borderRadius: 18, justifyContent: 'space-between' }]}>
          <View style={{ gap: 4, flex: 1 }}>
            <View style={{ alignSelf: 'flex-start', backgroundColor: C.warn, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
              <Text style={{ color: C.onAccent, fontSize: 13, fontWeight: '700' }}>{targetLabel(best.targetM)} 個人最佳</Text>
            </View>
            <Text style={{ color: C.dim, fontSize: 13 }}>
              {dayLabel(best.ranAt).replace('今天 · ', '')} · 配速 {paceLabel(averagePace(best.distanceM, best.durationS))} · 共 {bestCount} 次
            </Text>
          </View>
          <Text style={[NUM, { color: C.accent, fontSize: 48, fontWeight: '700', lineHeight: 52 }]} numberOfLines={1} adjustsFontSizeToFit>
            {durationLabel(best.durationS)}
          </Text>
        </View>
      ) : null}

      {shown.length === 0 ? <Text style={{ color: C.dim, fontSize: 15, lineHeight: 24, paddingVertical: 12 }}>還沒有長跑紀錄。到首頁的「長跑」分頁按「開始跑」，跑完會自動存在這裡。</Text> : null}
      <View>
        {shown.map((r) => (
          <RunRow key={r.id} run={r} best={r.targetM !== null && bests.get(r.targetM)?.id === r.id && runs.filter((x) => x.targetM === r.targetM && x.completed).length > 1} onPress={() => onOpen(r.id)} />
        ))}
      </View>
    </>
  );
}

function RunRow({ run, best, onPress }: { run: StoredRun; best: boolean; onPress(): void }) {
  const track = useMemo(() => run.track.map(decodePolyline), [run.track]);
  const when = `${dayLabel(run.ranAt).split(' · ')[0]} ${clockLabel(run.ranAt)}`;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.row, { gap: 12, minHeight: 80, borderTopWidth: 1, borderTopColor: C.raised }, pressed && { opacity: 0.7 }]}>
      <RouteThumb track={track} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={[s.row, { gap: 8 }]}>
          <Text style={[NUM, { color: C.text, fontSize: 17, fontWeight: '700' }]}>{kmLabel(run.distanceM)} km</Text>
          {run.targetM === null ? <Text style={{ color: C.dim, fontSize: 13 }}>自由跑</Text> : !run.completed ? <Text style={{ color: C.dim, fontSize: 13 }}>目標 {targetLabel(run.targetM)} 沒跑完</Text> : null}
          {best ? (
            <View style={{ backgroundColor: C.warn, borderRadius: 999, paddingVertical: 1, paddingHorizontal: 8 }}>
              <Text style={{ color: C.onAccent, fontSize: 12, fontWeight: '700' }}>最佳</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ color: C.dim, fontSize: 13 }}>
          {when} · 配速 {paceLabel(averagePace(run.distanceM, run.durationS))}
          {run.dirty && run.owner !== null ? ' · 待上傳' : ''}
        </Text>
      </View>
      <Text style={[NUM, { color: best ? C.accent : C.text, fontSize: 26, fontWeight: '700' }]}>{durationLabel(run.durationS)}</Text>
    </Pressable>
  );
}

function FilterChip({ title, on, onPress }: { title: string; on: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [{ minHeight: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: on ? C.text : C.raised, justifyContent: 'center' }, pressed && { opacity: 0.75 }]}
    >
      <Text style={[NUM, { color: on ? C.onAccent : C.soft, fontSize: 15, fontWeight: on ? '700' : '400' }]}>{title}</Text>
    </Pressable>
  );
}
