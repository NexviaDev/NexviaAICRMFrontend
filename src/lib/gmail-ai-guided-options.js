/**
 * 메일·문자 AI — 문장 다듬기(guided_rewrite) 5축 옵션 (라벨만 UI용, value는 API·프롬프트와 일치)
 */
export const AI_GUIDED_DEFAULTS = {
  goal: 'polish',
  tone: 'polite',
  audience: 'colleague',
  length: 'medium',
  extra: 'none'
};

export const AI_GUIDED_GOALS = [
  { value: 'polish', label: '자연스럽게 다듬기 (맞춤법·문법)' },
  { value: 'shorten', label: '더 짧게 요약' },
  { value: 'expand', label: '더 길고 자세히 확장' },
  { value: 'persuade', label: '설득력 있게 · 공식 비즈니스' },
  { value: 'casual_emotion', label: '감정 표현 · SNS 캐주얼' }
];

export const AI_GUIDED_TONES = [
  { value: 'polite', label: '정중한' },
  { value: 'friendly', label: '친근한' },
  { value: 'humorous', label: '유머러스한' },
  { value: 'calm_direct', label: '차분·직설적인' },
  { value: 'confident_warm', label: '자신감·감성' }
];

export const AI_GUIDED_AUDIENCES = [
  { value: 'friend', label: '친구' },
  { value: 'colleague', label: '직장 동료' },
  { value: 'boss', label: '상사' },
  { value: 'customer', label: '고객' },
  { value: 'public', label: '불특정 다수(SNS/대중)' }
];

export const AI_GUIDED_LENGTHS = [
  { value: 'one_line', label: '한 줄' },
  { value: 'short', label: '짧게 (2~3문장)' },
  { value: 'medium', label: '보통 (5문장 내외)' },
  { value: 'long', label: '길게 (자세한 설명)' }
];

export const AI_GUIDED_EXTRAS = [
  { value: 'none', label: '없음' },
  { value: 'emoji', label: '이모지 포함' },
  { value: 'no_emoji_keywords', label: '이모지 없이 · 핵심 강조' },
  { value: 'examples_story', label: '예시·비유/스토리' }
];
