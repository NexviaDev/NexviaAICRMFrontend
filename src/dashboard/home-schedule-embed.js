import { lazy, Suspense, useEffect, useRef, useState } from 'react';

const TodoList = lazy(() => import('@/todo-list/todo-list'));
const Calendar = lazy(() => import('@/calendar/calendar'));

/** 스크롤 근처에 올 때만 무거운 todo·calendar 청크 로드 */
function useNearViewport(rootMargin = '280px') {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setReady(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setReady(true);
          io.disconnect();
        }
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ready]);

  return [ref, ready];
}

function HomeScheduleEmbedFallback({ label }) {
  return (
    <div className="home-schedule-embed-fallback" role="status" aria-live="polite">
      <span className="home-pastel-spinner home-pastel-spinner--md" aria-hidden>
        <span className="home-pastel-spinner-ring" />
      </span>
      {label ? <span className="home-schedule-embed-fallback-label">{label}</span> : null}
    </div>
  );
}

/** 홈 패널 — 예정 업무 */
export function HomeTodoEmbed({ previewMax, forceMount = false }) {
  const [ref, near] = useNearViewport();
  const mount = forceMount || near;
  return (
    <div ref={ref} className="home-schedule-embed-host">
      {mount ? (
        <Suspense fallback={<HomeScheduleEmbedFallback label="예정 업무 불러오는 중…" />}>
          <TodoList embedded previewMax={previewMax} />
        </Suspense>
      ) : (
        <HomeScheduleEmbedFallback label="예정 업무 준비 중…" />
      )}
    </div>
  );
}

/** 홈 패널 — 캘린더 */
export function HomeCalendarEmbed({ hideBottomSection = true, forceMount = false }) {
  const [ref, near] = useNearViewport();
  const mount = forceMount || near;
  return (
    <div ref={ref} className="home-schedule-embed-host home-schedule-embed-host--calendar">
      {mount ? (
        <Suspense fallback={<HomeScheduleEmbedFallback label="캘린더 불러오는 중…" />}>
          <Calendar embedded hideBottomSection={hideBottomSection} />
        </Suspense>
      ) : (
        <HomeScheduleEmbedFallback label="캘린더 준비 중…" />
      )}
    </div>
  );
}

/** 모바일 「전체 보기」 모달 — 열릴 때만 청크 로드 */
export function HomeTodoModalEmbed() {
  return (
    <Suspense fallback={<HomeScheduleEmbedFallback label="예정 업무 불러오는 중…" />}>
      <TodoList embedded />
    </Suspense>
  );
}

export function HomeCalendarModalEmbed() {
  return (
    <Suspense fallback={<HomeScheduleEmbedFallback label="캘린더 불러오는 중…" />}>
      <Calendar embedded hideBottomSection={false} />
    </Suspense>
  );
}
