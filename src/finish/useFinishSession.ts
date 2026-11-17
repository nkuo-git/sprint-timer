import { useCallback, useMemo, useState } from 'react';
import type { FinishEvent } from '../core/multiFinish';
import { FinishSession } from './session';

/**
 * React 包裝：const { session, onEvent, version } = useFinishSession();
 * 把 onEvent 傳給 <MultiFinishCamera onEvent={onEvent} />；session 內容變動時 version 會 +1 觸發重繪。
 * 呼叫 session.addManual / moveMark / removeMark / reset 之後請呼叫 refresh()。
 */
export function useFinishSession() {
  const session = useMemo(() => new FinishSession(), []);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const onEvent = useCallback(
    (e: FinishEvent) => {
      if (session.handle(e)) setVersion((v) => v + 1);
    },
    [session],
  );
  return { session, onEvent, version, refresh };
}
