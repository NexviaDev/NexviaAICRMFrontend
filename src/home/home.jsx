import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useHomeTailwind } from "./use-home-tailwind";
import HomePwaInstallModal from "./home-pwa-install-modal";
import PrivacyPolicyModal from "../login/legal-modals/PrivacyPolicyModal";
import TermsOfServiceModal from "../login/legal-modals/TermsOfServiceModal";
import GoogleApiTermsModal from "../login/legal-modals/GoogleApiTermsModal";
import { openInChrome, PWA_SITE_URL, shouldOfferOpenInChrome } from "@/lib/pwa-open-in-chrome";
import "./home.css";

const NEXVIA_LOGO_URL =
  "https://res.cloudinary.com/djcsvvhly/image/upload/v1774253553/NexviaLogo2_yy0myj.png";

const HOME_LEGAL_FOOTER_LINKS = [
  { modal: "privacy", ko: "개인정보 보호정책", en: "Privacy Policy" },
  { modal: "terms", ko: "이용약관", en: "Terms of Service" },
  { modal: "google", ko: "Google API 약관", en: "Google API Terms" },
];

/** 홈 섹션 스크린샷 — Cloudinary CDN (public/landing 로컬 PNG 미사용) */
const LANDING_CDN = {
  sectionShotOne:
    "https://res.cloudinary.com/djcsvvhly/image/upload/v1779364136/Section1_5_jrcfww.png",
  sectionShotTwo:
    "https://res.cloudinary.com/djcsvvhly/image/upload/v1779364130/Section1_4_ljr380.png",
  sectionShotThree:
    "https://res.cloudinary.com/djcsvvhly/image/upload/v1779364129/Section1_3_ztqdth.png",
  sectionShotFour:
    "https://res.cloudinary.com/djcsvvhly/image/upload/v1779364122/Section1_2_jmxjhj.png",
  sectionFlowOne:
    "https://res.cloudinary.com/djcsvvhly/image/upload/v1779364131/Section2_1_rwiwx9.png",
  sectionFlowTwo:
    "https://res.cloudinary.com/djcsvvhly/image/upload/v1779364131/Section2_2_tbdgux.png",
  sectionMapOne:
    "https://res.cloudinary.com/djcsvvhly/image/upload/v1779364132/Section3_1_a3vctf.png",
  sectionMapTwo:
    "https://res.cloudinary.com/djcsvvhly/image/upload/v1779364132/Section3_2_nhgcmn.png",
};

const {
  sectionShotOne,
  sectionShotTwo,
  sectionShotThree,
  sectionShotFour,
  sectionFlowOne,
  sectionFlowTwo,
  sectionMapOne,
  sectionMapTwo,
} = LANDING_CDN;

const MALL_IMG =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuDcUOiHINbEu98MIDxgD1OTDoXzlUMsuj0nLs2afiPnsXK44FlYf8_Eqsw9-JQWMduzNw2G9RpcMo0MTvg-3bOcS38VvvGYb82hO80mcRv7HvdJKYyeSr3jLH7lKMB8zaAn6roXpZEdQ6avF9dgg-2asre_TZJilfMtM5vy8XJ9jAQNMO9bqSoMJMz__bKWI9FojU6PNTkEcgf3TzUWVHg9d4knc4cs-vd-BTo3qoFd645cA3X8_2LeMQbxLu0y9KfZRcGEDSBcXpI";

const CRM_IMG =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuA5JFghb7i4n1RC9gWZPcwADH5z9ctmZw-to-wfLC7gF_gv0IkqZYK817VizzbGKvncyULdgaIUTxHmz1bvpTazrH8zt8RF2RvKEWWWLWPAI1OqV3HZ_ozK_nfS2XquJsJxty7Oi8A2tZJfz7lFOUNaHjNHBl82VSFjRwdq-vU60k98Q0S7EDqpP_CwzeNWt9797dnpb-bgLwZHur1WSQtzkXCskAaH7fTelJk-jowvla_OjFOf2MjMgtSZXmTnP1HcXkgAzj9IgNI";

const NEXVIA_CRM_URL = "/login";
const PWA_QR_URL = "/nexvia-pwa-qr.svg";
const PWA_INSTALL_MODAL_DISMISS_KEY = "nexvia_home_pwa_install_dismissed";
const PWA_INSTALLED_KEY = "nexvia_pwa_installed";
const MOBILE_VIEWPORT_MQ = "(max-width: 1023px)";

const HELPU_INSTALLER_FILE_NAME = "[고객 접속 프로그램]_HelpULauncher.zip";
const HELPU_INSTALLER_URL = `/${encodeURIComponent(HELPU_INSTALLER_FILE_NAME)}`;



const transcriptPoints = [
  {
    icon: "audio_file",
    title: "녹음 파일 전사 후 자동 요약",
    body: "현장에서 녹음한 파일을 올리면 대화 내용을 전사하고, 핵심만 추려 바로 확인할 수 있게 정리합니다.",
  },
  {
    icon: "quick_reference_all",
    title: "이동 중에도 빠르게 복기",
    body: "이동 업무 중 발생해 기억하기 어려웠던 통화와 방문 내용을 짧은 시간 안에 다시 읽고 요약할 수 있습니다.",
  },
  {
    icon: "note_add",
    title: "일지로 즉시 등록",
    body: "자동 요약 결과를 회의 일지와 고객사 지원일지에 바로 연결해, 기록 누락 없이 업무 흐름으로 이어지게 돕습니다.",
  },
];

const transcriptCardStyles = [
  {
    card: "border-[#d6e8f8] bg-[#f4f9ff]",
    icon: "bg-white text-primary",
  },
  {
    card: "border-[#d7ebe3] bg-[#f3fbf7]",
    icon: "bg-white text-tertiary",
  },
  {
    card: "border-[#e4dcf6] bg-[#faf7ff]",
    icon: "bg-white text-secondary",
  },
];

const routeHighlights = [
  "지역별 리드 밀도와 방문 우선순위를 한 화면에서 정리",
  "현장 이동 전에 오늘 처리할 계정과 후속 작업을 묶어서 제안",
];

const revenueSnapshots = [
  {
    title: "반기 관점",
    body: "상반기와 하반기의 흐름 차이를 나란히 비교해 계절성이나 집중 구간을 더 차분하게 읽을 수 있습니다.",
    statLabel: "완만한 성장",
    statValue: "상반기 대비 +18%",
    accent: "secondary",
  },
  {
    title: "연간 관점",
    body: "연 단위 누적 흐름을 통해 지금의 속도가 어느 정도 페이스인지 자연스럽게 판단할 수 있게 돕습니다.",
    statLabel: "누적 안정도",
    statValue: "예상 범위 내 유지",
    accent: "primary",
  },
];

const executiveMetrics = [
  {
    title: "매출액",
    icon: "payments",
    value: 487600000,
    format: "currency",
    subtitle: "최근 30일 계약 기준",
    details: [
      { label: "기간 후반/전반", value: "+22.4%", tone: "bg-[#f4c89e]" },
      { label: "전년 동기 대비", value: "+31.8%", tone: "bg-[#b7d5f4]" },
    ],
  },
  {
    title: "매출 총이익률",
    icon: "percent",
    value: 41.6,
    format: "percent",
    decimals: 1,
    subtitle: "최근 30일 · 확정 매출 기준",
    details: [
      { label: "기간 후반/전반", value: "+4.2%p", tone: "bg-[#f4c89e]" },
      { label: "전년 동기 대비", value: "↗ +6.9%p", tone: "bg-[#b7d5f4]" },
    ],
  },
  {
    title: "목표 달성률",
    icon: "flag",
    value: 68,
    format: "percent",
    subtitle: "전체 목표 19건 중 유효 수주 13건",
    progressValue: 68,
  },
  {
    title: "신규 리드 건수",
    icon: "person_add",
    value: 14,
    format: "count",
    suffix: "건",
    subtitle: "최근 30일 신규 기회(생성일 기준)",
    details: [
      { label: "단기 추세", value: "167%", tone: "bg-[#f4c89e]" },
      { label: "직전 30일 대비", value: "+5건", tone: "bg-[#b7d5f4]" },
    ],
  },
  {
    title: "진행 중인 딜",
    icon: "handshake",
    value: 7,
    format: "count",
    suffix: "건",
    subtitle: "파이프라인 · 수주·종료유기 제외 (현재 시점 스냅샷)",
    details: [
      { label: "고액 제안 건", value: "3건", tone: "bg-[#f4c89e]" },
      { label: "이번 주 후속 예정", value: "5건", tone: "bg-[#b7d5f4]" },
    ],
  },
];

const productCards = [
  {

    name: "Nexvia Mall",
    href: "https://nexviamall.co.kr",
    accent: "primary",
    surface: "bg-primary-container text-on-primary-container",
    icon: "storefront",
    description:
      "소프트웨어 탐색, 비교, 주문 흐름을 깔끔하게 정리한 구매 경험입니다.",
    action: "Mall 바로가기",
  },

];

function MetricCard({ label, value, meta, tone = "primary" }) {
  const toneClass =
    tone === "tertiary"
      ? "text-tertiary"
      : tone === "secondary"
        ? "text-secondary"
        : "text-primary";

  return (
    <div className="rounded-xl bg-surface-container-low px-5 py-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-on-surface-variant">
        {label}
      </p>
      <div className="flex items-end justify-between gap-4">
        <span className="text-xl font-extrabold tracking-tight text-on-surface">
          {value}
        </span>
        <span className={`text-sm font-semibold ${toneClass}`}>{meta}</span>
      </div>
    </div>
  );
}

function formatAnimatedValue(metric, current) {
  if (metric.format === "currency") {
    return `₩${Math.round(current).toLocaleString("ko-KR")}`;
  }

  if (metric.format === "percent") {
    const value =
      metric.decimals != null
        ? current.toFixed(metric.decimals)
        : Math.round(current).toString();
    return `${value}%`;
  }

  return `${Math.round(current).toLocaleString("ko-KR")}${metric.suffix ?? ""}`;
}

function AnimatedExecutiveCard({ metric, active, delayMs = 0 }) {
  const [displayValue, setDisplayValue] = useState(0);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!active) return undefined;

    const enterTimer = window.setTimeout(() => {
      setEntered(true);
    }, delayMs);

    let frameId = 0;
    let startTime = 0;

    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / 1100, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(metric.value * eased);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(animate);
      }
    };

    const valueTimer = window.setTimeout(() => {
      frameId = window.requestAnimationFrame(animate);
    }, delayMs);

    return () => {
      window.clearTimeout(enterTimer);
      window.clearTimeout(valueTimer);
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [active, delayMs, metric.value]);

  return (
    <div
      className={`relative min-w-0 overflow-hidden rounded-[18px] border border-white/70 bg-white/76 px-4 py-3.5 shadow-[0_14px_36px_rgba(44,100,133,0.10)] backdrop-blur-[10px] transition-all duration-700 ${entered ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        }`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/90" />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="break-words text-[13px] font-semibold tracking-[-0.02em] text-on-surface">
            {metric.title}
          </p>
          <p className="mt-2 break-all text-[clamp(1.2rem,1.45vw,1.9rem)] font-extrabold leading-[1.05] tracking-[-0.05em] text-on-surface">
            {formatAnimatedValue(metric, displayValue)}
          </p>
          <p className="mt-2.5 break-words text-[11px] leading-4 text-on-surface-variant">
            {metric.subtitle}
          </p>
        </div>

        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/65 text-on-surface-variant shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
          <span className="material-symbols-outlined text-[16px]">
            {metric.icon}
          </span>
        </div>
      </div>

      {metric.progressValue ? (
        <div className="mt-5">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/55">
            <div
              className="h-full rounded-full bg-[#bdd3ea] transition-all duration-1000 ease-out"
              style={{ width: active ? `${metric.progressValue}%` : "0%" }}
            />
          </div>
        </div>
      ) : null}

      {metric.details?.length ? (
        <div className="mt-4 border-t border-white/65 pt-3">
          <div className="space-y-2">
            {metric.details.map((detail) => (
              <div
                key={`${metric.title}-${detail.label}`}
                className="flex items-center justify-between gap-3 text-[11px]"
              >
                <div className="flex min-w-0 items-center gap-2 text-on-surface-variant">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${detail.tone}`} />
                  <span className="truncate">{detail.label}</span>
                </div>
                <span className="shrink-0 font-semibold text-on-surface">
                  {detail.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isPwaStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function isPwaInstalledNow() {
  if (isPwaStandalone()) return true;
  try {
    return localStorage.getItem(PWA_INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}

function persistPwaInstalled() {
  try {
    localStorage.setItem(PWA_INSTALLED_KEY, "1");
  } catch {
    /* storage blocked */
  }
}

function clearPwaInstalled() {
  try {
    localStorage.removeItem(PWA_INSTALLED_KEY);
  } catch {
    /* storage blocked */
  }
}

function isInstallQrLanding() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("from") === "install";
}

const scrollRevealVariants = {
  rise: {
    hidden: "translate-y-16 scale-[0.96] opacity-0 blur-[14px]",
    visible: "translate-y-0 scale-100 opacity-100 blur-0",
  },
  glideLeft: {
    hidden: "translate-x-24 rotate-[4deg] scale-[0.96] opacity-0 blur-[12px]",
    visible: "translate-x-0 rotate-0 scale-100 opacity-100 blur-0",
  },
  glideRight: {
    hidden: "-translate-x-24 -rotate-[4deg] scale-[0.96] opacity-0 blur-[12px]",
    visible: "translate-x-0 rotate-0 scale-100 opacity-100 blur-0",
  },
  revealMask: {
    hidden:
      "translate-y-12 opacity-0 blur-[8px] [clip-path:inset(0_0_100%_0_round_28px)]",
    visible:
      "translate-y-0 opacity-100 blur-0 [clip-path:inset(0_0_0%_0_round_28px)]",
  },
  bloom: {
    hidden: "scale-[0.88] opacity-0 blur-[16px]",
    visible: "scale-100 opacity-100 blur-0",
  },
  tiltUp: {
    hidden: "translate-y-20 -rotate-[6deg] scale-[0.94] opacity-0 blur-[12px]",
    visible: "translate-y-0 rotate-0 scale-100 opacity-100 blur-0",
  },
};

function ScrollReveal({
  children,
  className = "",
  variant = "rise",
  delayMs = 0,
  threshold = 0.2,
  as: Tag = "div",
}) {
  const revealRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = revealRef.current;
    if (!node) return undefined;

    const reveal = () => setVisible(true);

    if (typeof window === "undefined") {
      reveal();
      return undefined;
    }

    const rect = node.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
      reveal();
      return undefined;
    }

    if (!("IntersectionObserver" in window)) {
      reveal();
      return undefined;
    }

    const fallbackTimer = window.setTimeout(() => {
      reveal();
    }, 1600 + delayMs);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting || entry.intersectionRatio > 0.02) {
          reveal();
          window.clearTimeout(fallbackTimer);
          observer.disconnect();
        }
      },
      {
        threshold: Math.min(threshold, 0.12),
        rootMargin: "0px 0px 12% 0px",
      },
    );

    observer.observe(node);

    return () => {
      window.clearTimeout(fallbackTimer);
      observer.disconnect();
    };
  }, [delayMs, threshold]);

  const variantState = scrollRevealVariants[variant] ?? scrollRevealVariants.rise;

  return (
    <Tag
      ref={revealRef}
      className={`transform-gpu transition-[opacity,transform,filter,clip-path] duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[transform,opacity,filter] ${visible ? variantState.visible : variantState.hidden} ${className}`}
      style={{ transitionDelay: `${delayMs}ms` }}
    >
      {children}
    </Tag>
  );
}

/** 섹션을 충분히 본 뒤 다음 전환 시작까지 */
const HOME_SECTION_DWELL_MS = 4000;

const HOME_SECTION_SHELL =
  "nexvia-home-section relative isolate h-full min-h-0 overflow-hidden px-6 md:px-10";

/** 같은 위치에 섹션을 하나씩 페이드 인·아웃 (스크롤 없음, 내부 ScrollReveal 유지) */
function HomeSectionRotator({ sections, onActiveSectionChange }) {
  const count = sections.length;
  const [index, setIndex] = useState(0);
  const dwellTimerRef = useRef(null);

  const clearTransitionTimers = useCallback(() => {
    if (dwellTimerRef.current) window.clearTimeout(dwellTimerRef.current);
  }, []);

  const runSectionTransition = useCallback(
    (nextIndex) => {
      if (count <= 1) return;
      const safe = ((nextIndex % count) + count) % count;
      if (safe === index) return;

      clearTransitionTimers();
      setIndex(safe);
    },
    [clearTransitionTimers, count, index],
  );

  const transitionTo = useCallback(
    (nextIndex) => {
      runSectionTransition(nextIndex);
    },
    [runSectionTransition],
  );

  const advanceAuto = useCallback(() => {
    runSectionTransition((index + 1) % count);
  }, [count, index, runSectionTransition]);

  useEffect(() => {
    if (count <= 1) return undefined;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return undefined;

    dwellTimerRef.current = window.setTimeout(() => {
      advanceAuto();
    }, HOME_SECTION_DWELL_MS);

    return () => {
      if (dwellTimerRef.current) window.clearTimeout(dwellTimerRef.current);
    };
  }, [advanceAuto, count, index]);

  useEffect(() => clearTransitionTimers, [clearTransitionTimers]);

  useEffect(() => {
    const section = sections[index];
    if (section?.id) onActiveSectionChange?.(section.id);
  }, [index, sections, onActiveSectionChange]);

  const active = sections[index];

  return (
    <div className="nexvia-home-rotator" aria-live="polite">
      <div
        className="nexvia-home-rotator__stage opacity-100"
      >
        {active ? (
          <section key={active.id} id={active.id} className={active.className}>
            {active.node}
          </section>
        ) : null}
      </div>

      {count > 1 ? (
        <nav className="nexvia-home-rotator__nav" aria-label="홈 섹션 이동">
          {sections.map((sec, i) => (
            <button
              key={sec.id}
              type="button"
              className={`nexvia-home-rotator__dot ${i === index ? "nexvia-home-rotator__dot--active" : ""}`}
              aria-label={`${sec.label} 보기`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => transitionTo(i)}
            />
          ))}
        </nav>
      ) : null}
    </div>
  );
}

export default function Home() {
  const isPublicStandalone =
    typeof window !== 'undefined' && !localStorage.getItem('crm_token');
  const tailwindReady = useHomeTailwind();
  const executiveMetricsRef = useRef(null);
  const [metricsActive, setMetricsActive] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [pwaInstalled, setPwaInstalled] = useState(() => isPwaStandalone());
  const [pwaModalOpen, setPwaModalOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [legalModal, setLegalModal] = useState(null);

  useEffect(() => {
    if (!legalModal) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setLegalModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [legalModal]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia(MOBILE_VIEWPORT_MQ);
    const update = () => setIsMobileViewport(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  /** 설치 여부 동기화 — 앱 삭제 후 localStorage만 남는 경우 모달이 다시 뜨게 */
  useEffect(() => {
    let cancelled = false;

    async function syncPwaInstalledState() {
      if (isPwaStandalone()) {
        persistPwaInstalled();
        if (!cancelled) {
          setPwaInstalled(true);
          setPwaModalOpen(false);
        }
        return;
      }

      const fromInstall = isInstallQrLanding();
      if (fromInstall) {
        clearPwaInstalled();
        try {
          sessionStorage.removeItem(PWA_INSTALL_MODAL_DISMISS_KEY);
        } catch {
          /* ignore */
        }
        if (!cancelled) setPwaInstalled(false);
      }

      if (typeof navigator.getInstalledRelatedApps === "function") {
        try {
          const apps = await navigator.getInstalledRelatedApps();
          if (cancelled) return;
          if (apps?.length) {
            persistPwaInstalled();
            setPwaInstalled(true);
            setPwaModalOpen(false);
            return;
          }
          clearPwaInstalled();
          setPwaInstalled(false);
          return;
        } catch {
          /* API unavailable */
        }
      }

      if (fromInstall) {
        setPwaInstalled(false);
        return;
      }

      if (!cancelled) setPwaInstalled(isPwaInstalledNow());
    }

    syncPwaInstalledState();
    return () => {
      cancelled = true;
    };
  }, []);

  /** /install → 홈 fallback 시 삼성 브라우저면 Chrome 전환 재시도 */
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const params = new URLSearchParams(window.location.search);
    if (params.get("from") !== "install") return undefined;
    if (!shouldOfferOpenInChrome()) return undefined;
    const timer = window.setTimeout(() => {
      openInChrome(`${PWA_SITE_URL}?from=install`);
    }, 400);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isPublicStandalone || pwaInstalled || !isMobileViewport) {
      setPwaModalOpen(false);
      return undefined;
    }
    if (sessionStorage.getItem(PWA_INSTALL_MODAL_DISMISS_KEY) === "1") return undefined;
    const delayMs = installPrompt ? 350 : 1400;
    const timer = window.setTimeout(() => setPwaModalOpen(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [isPublicStandalone, pwaInstalled, isMobileViewport, installPrompt]);

  const handleClosePwaModal = useCallback(() => {
    sessionStorage.setItem(PWA_INSTALL_MODAL_DISMISS_KEY, "1");
    setPwaModalOpen(false);
  }, []);

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      clearPwaInstalled();
      setPwaInstalled(false);
      setInstallPrompt(event);
    };
    const onAppInstalled = () => {
      setInstallPrompt(null);
      persistPwaInstalled();
      setPwaInstalled(true);
      setPwaModalOpen(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia?.("(display-mode: standalone)");
    if (!mq?.addEventListener) return undefined;
    const onDisplayMode = () => {
      if (!isPwaStandalone()) return;
      persistPwaInstalled();
      setPwaInstalled(true);
      setPwaModalOpen(false);
    };
    mq.addEventListener("change", onDisplayMode);
    return () => mq.removeEventListener("change", onDisplayMode);
  }, []);

  const handleInstallPwa = useCallback(async () => {
    if (!installPrompt) return;
    const promptEvent = installPrompt;
    await promptEvent.prompt();
    try {
      const { outcome } = await promptEvent.userChoice;
      if (outcome === "accepted") {
        persistPwaInstalled();
        setPwaInstalled(true);
        setPwaModalOpen(false);
      }
    } catch {
      /* userChoice unsupported */
    }
    setInstallPrompt(null);
  }, [installPrompt]);

  /** 대시보드 섹션이 로테이터에 올라온 뒤 수치판 애니메이션 시작 */
  const handleActiveSection = useCallback(
    (sectionId) => {
      if (sectionId !== "overview") return;
      const activate = () => setMetricsActive(true);
      if (executiveMetricsRef.current) {
        activate();
        return;
      }
      requestAnimationFrame(() => {
        if (executiveMetricsRef.current) activate();
        else window.setTimeout(activate, 80);
      });
    },
    [],
  );

  if (!tailwindReady) {
    return (
      <div className="nexvia-home-root nexvia-home-loading" role="status" aria-live="polite">
        불러오는 중…
      </div>
    );
  }

  return (
    <div
      className={`nexvia-home-root relative flex h-full min-h-0 flex-col overflow-hidden bg-white text-on-background antialiased ${isPublicStandalone ? "nexvia-home-root--standalone" : ""}`}
    >
      {isPublicStandalone ? (
        <header className="nexvia-home-topbar" aria-label="홈 상단">
          <div className="nexvia-home-topbar__inner">
            <Link to="/" className="nexvia-home-topbar__logo" aria-label="Nexvia 홈">
              <img src={NEXVIA_LOGO_URL} alt="Nexvia" decoding="async" />
            </Link>
            <Link to="/login" className="nexvia-home-topbar__login">
              <span className="material-symbols-outlined" aria-hidden>
                login
              </span>
              로그인
            </Link>
          </div>
        </header>
      ) : null}

      {isPublicStandalone ? (
        <aside className="nexvia-home-pwa-card nexvia-home-pwa-card--floating hidden lg:flex" aria-label="Nexvia CRM 앱 설치 안내">
          <div className="nexvia-home-pwa-card__copy">
            <p className="nexvia-home-pwa-card__eyebrow">PWA install</p>
            <h3>휴대폰에서는 앱처럼 사용하세요</h3>
            <p>
              QR 코드를 스캔하면 Android에서는 <strong>Chrome</strong>으로 열립니다.
              이어서 앱 설치 또는 홈 화면에 추가를 진행하세요.
            </p>
          </div>
          <div className="nexvia-home-pwa-card__qrWrap">
            <img
              src={PWA_QR_URL}
              alt="Nexvia CRM PWA 설치 QR 코드"
              loading="lazy"
              decoding="async"
            />
          </div>
          <button
            type="button"
            className="nexvia-home-pwa-card__button"
            onClick={handleInstallPwa}
            disabled={!installPrompt || pwaInstalled}
          >
            <span className="material-symbols-outlined" aria-hidden>
              install_desktop
            </span>
            {pwaInstalled ? "설치 완료" : installPrompt ? "이 PC에 설치" : "QR로 모바일 설치"}
          </button>
        </aside>
      ) : null}

      {isPublicStandalone && !pwaInstalled ? (
        <HomePwaInstallModal
          open={pwaModalOpen}
          onClose={handleClosePwaModal}
          onInstall={handleInstallPwa}
          installReady={Boolean(installPrompt)}
        />
      ) : null}

      <main className="nexvia-home-main min-h-0 flex-1">
        <HomeSectionRotator
          onActiveSectionChange={handleActiveSection}
          sections={[
            {
              id: "overview",
              label: "대시보드",
              className: `${HOME_SECTION_SHELL} bg-white`,
              node: (
                <>
                  <div className="pointer-events-none absolute inset-0 bg-white">
                    <ScrollReveal
                      variant="glideLeft"
                      delayMs={120}
                      threshold={0.12}
                      className="absolute right-[-8%] top-[-10%] hidden h-[110%] w-[64%] bg-white lg:block"
                    >
                      <img
                        src={sectionShotOne}
                        alt=""
                        aria-hidden="true"
                        className="absolute right-[12%] top-[2%] w-[40%] rotate-[26deg] rounded-[18px] border border-white shadow-[0_36px_88px_rgba(44,100,133,0.22)] saturate-[1.02]"
                      />
                      <img
                        src={sectionShotTwo}
                        alt=""
                        aria-hidden="true"
                        className="absolute right-[-3%] top-[16%] w-[45%] rotate-[10deg] rounded-[18px] border border-white shadow-[0_36px_88px_rgba(44,100,133,0.2)] saturate-[1.03]"
                      />
                      <img
                        src={sectionShotThree}
                        alt=""
                        aria-hidden="true"
                        className="absolute right-[16%] top-[39%] w-[50%] -rotate-[15deg] rounded-[18px] border border-white shadow-[0_36px_88px_rgba(44,100,133,0.22)] saturate-[1.03]"
                      />
                      <img
                        src={sectionShotFour}
                        alt=""
                        aria-hidden="true"
                        className="absolute right-[3%] top-[62%] w-[36%] rotate-[18deg] rounded-[18px] border border-white shadow-[0_32px_76px_rgba(44,100,133,0.2)] saturate-[1.02]"
                      />
                    </ScrollReveal>
                  </div>
                  <div className="nexvia-home-section-inner relative z-10 mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col justify-center overflow-hidden">
                    <div className="flex min-h-0 flex-col gap-4 md:flex-row md:items-end md:justify-between">
                      <ScrollReveal variant="revealMask" className="w-full">
                        <h2 className="max-w-4xl font-display text-[clamp(2rem,4vw,3.2rem)] font-extrabold tracking-[-0.04em] text-on-surface">
                          월간회의 때만 보던 현황을 이제는 대시보드에서 바로 확인합니다
                        </h2>
                        <p className="mt-4 max-w-4xl text-base leading-8 text-on-surface-variant md:text-lg">
                          대표가 월간회의에서만 받아보던 핵심 현황을 실시간으로 열어,
                          지금 우리 회사가 어느 정도 속도로 움직이고 있는지 더 빠르게
                          판단할 수 있게 돕습니다. 매출액, 총 이익률, 목표 달성률,
                          신규 리드 건수, 진행 중인 딜까지 한 화면에서 이어서 파악할 수
                          있다는 점을 강조합니다.
                        </p>
                        <div
                          ref={executiveMetricsRef}
                          className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5"
                        >
                          {executiveMetrics.map((metric, index) => (
                            <AnimatedExecutiveCard
                              key={metric.title}
                              metric={metric}
                              active={metricsActive}
                              delayMs={index * 100}
                            />
                          ))}
                        </div>
                      </ScrollReveal>
                    </div>


                  </div>
                </>
              ),
            },
            {
              id: "flow",
              label: "녹음·전사",
              className: `${HOME_SECTION_SHELL} bg-white`,
              node: (
                <div className="nexvia-home-section-inner mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col justify-center overflow-hidden">
                  <ScrollReveal variant="bloom" className="mx-auto max-w-3xl text-center">
                    <h2 className="font-display text-[clamp(2rem,4vw,3.2rem)] font-extrabold tracking-[-0.04em] text-on-surface">
                      녹음 파일은 전사되고 핵심은 자동으로 정리됩니다
                    </h2>
                    <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-on-surface-variant md:text-lg">
                      이동 중 지나가기 쉬웠던 내용을 다시 붙잡지 않아도 됩니다.
                      녹음 업로드부터 전사, 요약, 일지 등록까지 한 흐름으로 이어지는
                      화면을 더 선명하게 보여주는 구간입니다.
                    </p>
                  </ScrollReveal>

                  <div className="nexvia-home-transcript-grid mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center lg:gap-6">
                    <ScrollReveal
                      variant="glideRight"
                      className="nexvia-home-transcript-visual relative h-full min-h-0 max-h-[min(48vh,480px)] overflow-hidden rounded-[30px] shadow-[0_28px_70px_rgba(44,100,133,0.08)] lg:max-h-[min(52vh,520px)]"
                    >
                      <div className="absolute left-[-8%] top-[10%] z-10 w-[104%] rotate-[10deg] overflow-hidden rounded-[24px] border border-white/85 shadow-[0_32px_72px_rgba(44,100,133,0.16)]">
                        <img
                          src={sectionFlowTwo}
                          alt="전사 결과와 요약 결과를 일지로 연결하는 Nexvia 화면"
                          className="h-full w-full scale-[1.03] object-cover object-right-top"
                        />
                      </div>
                      <div className="absolute right-[-6%] top-[22%] z-20 w-[104%] rotate-[10deg] overflow-hidden rounded-[24px] border border-white/90 shadow-[0_38px_86px_rgba(44,100,133,0.24)]">
                        <img
                          src={sectionFlowOne}
                          alt="녹음 파일 업로드, AI 요약, 전사 내용이 보이는 Nexvia 화면"
                          className="h-full w-full object-contain object-left-top"
                        />
                      </div>
                    </ScrollReveal>

                    <div className="nexvia-home-transcript-cards relative z-20 grid min-h-0 gap-3 overflow-hidden lg:-ml-8 lg:gap-4">
                      {transcriptPoints.map((point, index) => (
                        <ScrollReveal
                          key={point.title}
                          variant={index === 1 ? "bloom" : index % 2 === 0 ? "glideLeft" : "tiltUp"}
                          delayMs={index * 120}
                          className={`nexvia-home-transcript-card flex gap-5 rounded-[24px] border px-6 py-6 shadow-[0_18px_44px_rgba(44,100,133,0.06)] md:px-8 ${transcriptCardStyles[index]?.card}`}
                        >
                          <div
                            className={`nexvia-home-transcript-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-[0_12px_30px_rgba(44,100,133,0.05)] ${transcriptCardStyles[index]?.icon}`}
                          >
                            <span className="material-symbols-outlined text-[22px]">
                              {point.icon}
                            </span>
                          </div>
                          <div>
                            <h3 className="nexvia-home-transcript-title font-display text-xl font-bold tracking-[-0.03em] text-on-surface">
                              {point.title}
                            </h3>
                            <p className="nexvia-home-transcript-body mt-2 text-sm leading-7 text-on-surface-variant md:text-base">
                              {point.body}
                            </p>
                          </div>
                        </ScrollReveal>
                      ))}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              id: "map",
              label: "방문 전략",
              className: `${HOME_SECTION_SHELL} bg-white`,
              node: (
                <>
                  <img
                    src={sectionMapTwo}
                    alt=""
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-[-5%] left-[-8%] hidden w-[48%] opacity-38 lg:block"
                  />
                  <div className="nexvia-home-section-inner relative z-10 mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col justify-center gap-6 overflow-hidden lg:flex-row lg:items-center lg:justify-between lg:gap-8">
                    <ScrollReveal variant="rise" className="max-w-xl">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-tertiary">
                        Spatial rhythm
                      </p>
                      <h2 className="mt-5 font-display text-[clamp(2rem,4vw,3.3rem)] font-extrabold tracking-[-0.04em] text-on-surface">
                        데이터를 설계하는 최적의 방문 전략
                      </h2>
                      <p className="mt-6 text-base leading-8 text-on-surface-variant md:text-lg">
                        지도와 일정, 후속 업무를 각각 따로 보지 않고 한 장면 안에서
                        연결합니다. 파편화된 정보를 덜어내고 오늘 움직여야 할 이유만
                        남기는 방식입니다.
                      </p>

                      <div className="mt-8 space-y-4">
                        {routeHighlights.map((item) => (
                          <div
                            key={item}
                            className="flex items-center gap-4 rounded-xl border border-white/45 bg-white/28 px-5 py-4 backdrop-blur-[4px]"
                          >
                            <span className="material-symbols-outlined text-tertiary">
                              near_me
                            </span>
                            <span className="text-sm font-medium leading-6 text-on-surface md:text-base">
                              {item}
                            </span>
                          </div>
                        ))}
                      </div>
                    </ScrollReveal>

                    <ScrollReveal
                      variant="revealMask"
                      delayMs={120}
                      className="w-full max-w-[560px] rounded-[28px] border border-white/55 bg-white/32 p-4 shadow-[0_28px_60px_rgba(44,100,133,0.08)] backdrop-blur-[12px]"
                    >
                      <div className="relative overflow-hidden rounded-[24px] bg-white/24 p-4 md:p-5">
                        <div className="mb-5 flex items-start justify-between">


                        </div>

                        <div className="relative overflow-hidden rounded-[24px] border border-white/60 shadow-[0_18px_36px_rgba(44,100,133,0.06)]">
                          <img
                            src={sectionMapOne}
                            alt="고객 위치와 방문 후보가 지도 위에 표시된 Nexvia 화면"
                            className="h-full w-full object-cover object-center opacity-100"
                          />
                        </div>
                      </div>
                    </ScrollReveal>
                  </div>
                </>
              ),
            },
          ]}
        />
      </main>

      <footer className="nexvia-home-legal-footer" aria-label="법적 고지">
        {HOME_LEGAL_FOOTER_LINKS.map((item, index) => (
          <span key={item.modal} className="nexvia-home-legal-footer__group">
            {index > 0 ? (
              <span className="nexvia-home-legal-footer__sep" aria-hidden>
                ·
              </span>
            ) : null}
            <button
              type="button"
              className="nexvia-home-legal-footer__link"
              onClick={() => setLegalModal(item.modal)}
            >
              <span className="nexvia-home-legal-footer__label-ko">{item.ko}</span>
              <span className="nexvia-home-legal-footer__label-en">{item.en}</span>
            </button>
          </span>
        ))}
      </footer>

      <PrivacyPolicyModal open={legalModal === "privacy"} onClose={() => setLegalModal(null)} />
      <TermsOfServiceModal open={legalModal === "terms"} onClose={() => setLegalModal(null)} />
      <GoogleApiTermsModal open={legalModal === "google"} onClose={() => setLegalModal(null)} />
    </div>
  );
}
