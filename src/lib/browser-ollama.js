const OLLAMA_BASE = 'http://127.0.0.1:11434';

const PREFERRED_OLLAMA_MODELS = [
  'qwen2.5:7b',
  'qwen2.5:14b',
  'qwen2.5:3b',
  'qwen2.5',
  'gemma2:9b',
  'gemma2',
  'phi3:mini',
  'phi3',
  'llama3.2',
  'llama3.1',
  'llama3',
  'mistral'
];

function modelBaseName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .split(':')[0];
}

export async function resolveBrowserOllamaModel(preferred) {
  const want = String(preferred || '').trim();
  let installed = [];
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      installed = (Array.isArray(data?.models) ? data.models : [])
        .map((m) => String(m?.name || m?.model || '').trim())
        .filter(Boolean);
    }
  } catch (_) {
    installed = [];
  }

  if (want) {
    const exact = installed.find((n) => n === want);
    if (exact) return exact;
    if (!want.includes(':')) {
      const byFamily = installed.find(
        (n) => modelBaseName(n) === modelBaseName(want) || n.startsWith(`${want}:`)
      );
      if (byFamily) return byFamily;
    }
  }

  for (const cand of PREFERRED_OLLAMA_MODELS) {
    const exact = installed.find((n) => n === cand);
    if (exact) return exact;
  }
  for (const cand of PREFERRED_OLLAMA_MODELS) {
    if (cand.includes(':')) continue;
    const byFamily = installed.find(
      (n) => modelBaseName(n) === cand || n.startsWith(`${cand}:`)
    );
    if (byFamily) return byFamily;
  }
  if (installed.length) return installed[0];
  throw new Error(
    '로컬 AI에 사용 가능한 모델이 없습니다. PC에 로컬 AI를 설치·실행한 뒤 다시 시도해 주세요.'
  );
}

/** 브라우저에서 Ollama 직접 호출 (서버가 로컬 Ollama에 닿지 못할 때) */
export async function answerWithBrowserOllama({ prompt, chunks, model }) {
  const useModel = await resolveBrowserOllamaModel(model);
  const allowedIds = new Set((Array.isArray(chunks) ? chunks : []).map((c) => String(c.id)));
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), 90000) : null;
  let res;
  try {
    res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller?.signal,
      body: JSON.stringify({
        model: useModel,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: 'JSON only. No markdown.' },
          { role: 'user', content: String(prompt || '') }
        ],
        options: { temperature: 0.2 }
      })
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(
        '로컬 AI 응답이 시간 초과되었습니다. 잠시 후 다시 시도하거나 로컬 AI를 끄고 클라우드 키를 사용해 주세요.'
      );
    }
    throw new Error(
      '이 PC의 로컬 AI에 연결할 수 없습니다. 로컬 AI를 설치·실행한 뒤 다시 시도해 주세요.'
    );
  } finally {
    if (timer) window.clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404 && /not found/i.test(body)) {
      throw new Error(
        '로컬 AI 모델을 찾을 수 없습니다. PC에 모델을 설치한 뒤 다시 시도해 주세요.'
      );
    }
    throw new Error(`로컬 AI 오류 (${res.status})${body ? `: ${body.slice(0, 120)}` : ''}`);
  }
  const data = await res.json().catch(() => ({}));
  const rawText = String(data?.message?.content || data?.response || '').trim();
  if (!rawText) throw new Error('로컬 AI가 답변을 생성하지 못했습니다.');
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (_) {
    const m = rawText.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('로컬 AI 답변 형식을 해석하지 못했습니다.');
    parsed = JSON.parse(m[0]);
  }
  const answer = String(parsed?.answer || '').trim();
  const citationIds = Array.isArray(parsed?.citationIds)
    ? parsed.citationIds.map((id) => String(id)).filter((id) => allowedIds.has(id))
    : [];
  return { answer, citationIds, ollamaModel: useModel };
}
