/**
 * 개발 모드에서만: React·Google Maps 등이 반복 출력하는 안내/폐기 경고를 콘솔에서 숨깁니다.
 * (프로덕션 번들에서는 import.meta.env.DEV 가 false 로 정리되어 동작이 제거됩니다.)
 */
if (import.meta.env.DEV) {
  const textFromArgs = (args) =>
    args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a && typeof a.message === 'string') return a.message;
        return '';
      })
      .join('\n');

  const shouldMute = (args) => {
    const t = textFromArgs(args);
    return (
      t.includes('Download the React DevTools') ||
      t.includes('google.maps.Marker is deprecated') ||
      t.includes('AdvancedMarkerElement instead')
    );
  };

  for (const method of ['log', 'info', 'warn']) {
    const orig = console[method].bind(console);
    console[method] = (...args) => {
      if (shouldMute(args)) return;
      orig(...args);
    };
  }
}
