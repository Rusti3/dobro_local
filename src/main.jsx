import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Leaf,
  Heart,
  Users,
  CalendarDays,
  Compass,
  Check,
  MapPin,
  Map as MapIcon,
  Clock,
  ChevronRight,
  Copy,
  ExternalLink,
  Plus,
  Sprout,
  Flower2,
  HandHeart,
  MessageCircle,
  BookOpen,
  X,
  Settings,
  ShieldCheck,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Gauge,
  Moon,
  Sun,
  UserRound,
  Award,
  Target,
  ListChecks,
} from "lucide-react";
import "./style.css";
import Garden from './Garden.jsx';
const mapRetryKey = "first-step-map-chunk-retry";
const VolunteerMap = lazy(async () => {
  try {
    const module = await import("./VolunteerMap.jsx");
    sessionStorage.removeItem(mapRetryKey);
    return module;
  } catch (error) {
    const chunkLoadFailed = /dynamically imported|module script|importing a module/i.test(String(error?.message || error));
    if (chunkLoadFailed && !sessionStorage.getItem(mapRetryKey)) {
      sessionStorage.setItem(mapRetryKey, "1");
      const next = new URL(window.location.href);
      next.searchParams.set("tab", "map");
      window.location.replace(next);
      return new Promise(() => {});
    }
    throw error;
  }
});

class MapErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error("Volunteer map failed to render", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="map-fallback"><MapPin size={28}/><h2>Карта временно не открылась</h2><p>Лента добрых дел продолжает работать. Обнови карту — страница восстановится без белого экрана.</p><button className="primary" onClick={() => { sessionStorage.removeItem(mapRetryKey); window.location.reload(); }}><RefreshCw size={16}/>Обновить карту</button></div>;
  }
}
// MAX Bridge is injected by the MAX client. The app still renders in a normal
// browser for demo mode, where this value is undefined.
const maxApp = window.WebApp;
function maxInitData() {
  // Official MAX launch parameters are duplicated in the URL fragment. Read
  // them there as a fallback because some MAX WebView versions expose the
  // fragment before Bridge.initData becomes available.
  if (typeof window.WebApp?.initData === "string" && window.WebApp.initData)
    return window.WebApp.initData;
  const fragment = new URLSearchParams(window.location.hash.slice(1)).get("WebAppData");
  if (fragment) return fragment;
  return new URLSearchParams(window.location.search).get("WebAppData") || "";
}
async function api(url, method = "GET", body) {
  const initData = maxInitData();
  const r = await fetch("/api" + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(initData ? { "X-Max-Init-Data": initData } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(data.error || "Не удалось сохранить. Попробуйте ещё раз.");
  return data;
}
const categories = { all: "Всё добро", animals: "Животным", people: "Людям" };
const themeMeta = {
  animals: ["🐶", "Животные", "Забота о тех, кто ждёт своего человека"],
  ecology: ["🌱", "Экология", "Чистая среда и бережные привычки"],
  elderly: ["👵", "Пожилые", "Общение, внимание и тёплые встречи"],
  children: ["🧒", "Дети", "Поддержка, игры и новые возможности"],
  city: ["🏙", "Помощь городу", "Делать свой район удобнее и добрее"],
  creativity: ["🎨", "Творчество", "Мастерские, музыка, фото и культура"],
  activity: ["🏃", "Активности", "Движение, спорт и выезды"],
  education: ["🎓", "Образование", "Делиться знаниями и быть наставником"],
  events: ["🤝", "Мероприятия", "Помогать команде на событиях"],
  online_help: ["💻", "Онлайн-помощь", "Дизайн, тексты и помощь из дома"],
  donation: ["🩸", "Донорство", "Поддержать тех, кому нужна кровь"],
  recycling: ["♻️", "Переработка", "Сбор вещей и вторсырья"],
  nature: ["🌳", "Природа", "Парки, леса, берега и животный мир"],
  charity: ["❤️", "Благотворительность", "Адресная и гуманитарная помощь"],
};
const interestOptions = [
  "animals", "ecology", "elderly", "children", "city", "creativity", "activity",
  "education", "events", "online_help", "donation", "recycling", "nature", "charity",
].map((id) => [id, ...themeMeta[id]]);
const quickFeedFilters = [
  ["first_time", "Первый раз"],
  ["easy", "Попроще"],
  ["remote", "Из дома"],
  ["calm", "Спокойно"],
  ["friends", "С друзьями"],
  ["one_off", "Разово"],
];
const audienceFilters = [
  ["animals", "Животные"],
  ["children", "Дети"],
  ["elderly_people", "Пожилые"],
  ["people_with_disabilities", "Люди с инвалидностью"],
  ["military_personnel", "Военнослужащие"],
  ["environment", "Природа"],
  ["nonprofit_organizations", "НКО"],
];
const complexityText = (score) => score === null || score === undefined
  ? "Сложность уточняется"
  : score <= 19 ? "Очень просто"
    : score <= 39 ? "Попроще"
      : score <= 59 ? "Средняя сложность"
        : score <= 79 ? "Потребует опыта"
          : "Сложная задача";
const complexityCardStyle = (score) => {
  if (!Number.isFinite(score)) return undefined;
  const value = Math.max(0, Math.min(100, score));
  const hue = value <= 50
    ? 128 - value * 1.6
    : 48 - (value - 50) * 0.86;
  return { "--difficulty-hue": hue.toFixed(1) };
};
const positiveLabels = {
  clear_duties: "Понятные обязанности", simple_tasks: "Простые задачи",
  no_experience_required: "Опыт не нужен", briefing_provided: "Есть инструктаж",
  coordinator_support: "Рядом координатор", flexible_schedule: "Гибкое время",
  short_shift: "Короткая смена", choice_of_tasks: "Можно выбрать задачу",
  group_format: "Работа в группе", remote_format: "Можно из дома",
};
const concernLabels = {
  unclear_duties: "Уточнить обязанности", unclear_conditions: "Уточнить условия",
  specialized_skill: "Нужны навыки", qualification_required: "Нужна квалификация",
  high_physical_load: "Физическая нагрузка", high_emotional_load: "Эмоциональная нагрузка",
  high_social_load: "Много общения", high_responsibility: "Высокая ответственность",
  long_or_regular_commitment: "Долгое участие", application_or_selection: "Есть отбор",
  own_resource_required: "Нужны свои материалы", age_or_consent_condition: "Есть возрастные условия",
  safety_needs_review: "Проверить безопасность",
};
const unknownLabels = {
  exact_duties: "точные обязанности", exact_location: "место", exact_time: "время",
  duration: "длительность", physical_requirements: "физическую нагрузку", training: "обучение",
  supervision: "сопровождение", equipment: "что взять", accessibility: "доступность",
  group_participation: "можно ли вместе", remote_process: "порядок удалённой работы",
};
const commitmentLabels = {
  one_off: "Один визит", multiple_visits: "Несколько встреч", regular: "Регулярно",
  flexible: "Гибко", unknown: "По договорённости",
};
const annotationValueLabels = {
  minimal: "Минимальная", light: "Лёгкая", moderate: "Средняя", heavy: "Высокая",
  low: "Низкая", high: "Высокая", none: "Не нужны", briefing: "Достаточно инструктажа",
  specialized: "Нужны специальные навыки", licensed: "Нужна квалификация", solitary: "Почти без общения",
  supervised_simple: "Простая, под присмотром", independent_routine: "Самостоятельная обычная",
  safety_critical: "Связана с безопасностью", walk_in: "Можно просто записаться", registration: "Нужна регистрация",
  application: "Нужна анкета", training: "Нужно обучение", selection: "Есть отбор", up_to_2h: "До двух часов",
  half_day: "Полдня", full_day: "Полный день", multi_day: "Несколько дней", regular: "Регулярно",
  unknown: "Не указано", solo: "Одному", pair: "Вдвоём", small_group: "Небольшой группой",
  large_group: "Большой командой", own_pet: "Свой питомец", smartphone: "Смартфон", camera: "Камера",
  computer: "Компьютер", car: "Автомобиль", tools: "Инструменты", protective_equipment: "Защитное снаряжение",
  materials: "Материалы", money_for_materials: "Деньги на материалы", language_skill: "Знание языка",
  driving_license: "Водительские права", professional_qualification: "Профессиональная квалификация",
  health_eligibility: "Медицинские требования", interview: "Собеседование", parental_consent: "Согласие родителей",
  source_registration: "Регистрация на площадке источника",
};
const complexityAxes = [
  ["physicalLoad", "Физическая нагрузка"], ["emotionalLoad", "Эмоциональная нагрузка"],
  ["skillRequirement", "Навыки"], ["socialLoad", "Общение"],
  ["responsibility", "Ответственность"], ["entryBarrier", "Порог входа"],
  ["timeCommitment", "Время"],
];
const formatLabels = { online: "Онлайн", on_site: "На месте", field_trip: "Выезд", hybrid: "Смешанный", unknown: "Не указано" };
const dateLabel = (d) =>
  d
    ? new Date(d).toLocaleString("ru-RU", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Moscow",
      }) + " · МСК"
    : "Дату согласуем с организатором";
const live = (e) => Date.parse(e.endsAt) > Date.now();
const themeTitle = (event) => themeMeta[event.theme]?.[1] || categories[event.category] || "Доброе дело";
function Plant({ stage = 2, small = false }) {
  return (
    <svg
      className={small ? "plant small" : "plant"}
      viewBox="0 0 360 320"
      fill="none"
      aria-hidden="true"
    >
      <ellipse cx="180" cy="276" rx="117" ry="17" fill="#dbdec7" />
      <path
        d="M81 265C111 253 133 270 151 261S201 261 224 265 259 258 277 266"
        stroke="#667f58"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M177 262C173 222 199 185 184 133"
        stroke="#365a3e"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M186 192C137 195 109 174 108 139 155 132 185 151 186 192Z"
        fill="#759857"
      />
      <path
        d="M183 161C223 159 245 132 240 98 196 100 180 123 183 161Z"
        fill="#476d43"
      />
      <path
        d="M183 190 136 157M185 157 222 119"
        stroke="#e6ecd0"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {stage > 1 && (
        <>
          <path
            d="M181 133C143 126 141 88 150 66 187 82 192 104 181 133Z"
            fill="#a1b674"
          />
          <path d="M181 129 160 88" stroke="#f5f5ed" strokeWidth="2" />
        </>
      )}
      {stage > 2 && (
        <>
          <circle cx="231" cy="72" r="17" fill="#e8ab82" />
          <circle cx="255" cy="83" r="17" fill="#e8ab82" />
          <circle cx="249" cy="109" r="17" fill="#e8ab82" />
          <circle cx="222" cy="109" r="17" fill="#e8ab82" />
          <circle cx="211" cy="84" r="17" fill="#e8ab82" />
          <circle cx="232" cy="90" r="13" fill="#f4d399" />
        </>
      )}
      <path
        d="M108 90v12m-6-6h12M268 167v12m-6-6h12"
        stroke="#a4ad84"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="103" cy="224" r="4" fill="#d8a079" />
      <circle cx="269" cy="53" r="4" fill="#d8a079" />
      <path
        d="M223 252q8-21 19-13M130 254q-12-24-23-20"
        stroke="#96a46c"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function App() {
  const [data, setData] = useState(null),
    [fatal, setFatal] = useState(""),
    [tab, setTab] = useState(() => {
      const requested = new URLSearchParams(location.search).get("tab") || "home";
      if (requested === "discover" || requested === "together") return "home";
      if (requested === "plan") return "profile";
      return requested;
    }),
    [detail, setDetail] = useState(null),
    [onboard, setOnboard] = useState(false),
    [profile, setProfile] = useState({ category: "all", barrier: "company" }),
    [interestSelection, setInterestSelection] = useState([]),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [invite, setInvite] = useState(null),
    [inviteError, setInviteError] = useState(""),
    [settings, setSettings] = useState(false),
    [share, setShare] = useState(""),
    [calibrationDone, setCalibrationDone] = useState(false),
    [feedLimit, setFeedLimit] = useState(12),
    [feedFilters, setFeedFilters] = useState([]),
    [audienceFilter, setAudienceFilter] = useState(""),
    [feedQuery, setFeedQuery] = useState(""),
    [feedFiltersOpen, setFeedFiltersOpen] = useState(false),
    [registrationName, setRegistrationName] = useState(""),
    [registrationAge, setRegistrationAge] = useState(""),
    [theme, setTheme] = useState(() => localStorage.getItem("first-step-theme") || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const [swipeDrag, setSwipeDrag] = useState(0),
    [swipeStart, setSwipeStart] = useState(null);
  const feedSentinel = useRef(null);
  const inviteCode =
    new URLSearchParams(location.search).get("invite") ||
    maxApp?.initDataUnsafe?.start_param?.replace(/^i_/, "");
  async function load() {
    try {
      const d = await api("/bootstrap");
      setData(d);
      setProfile(d.user.profile);
      setInterestSelection(d.user.profile.interests || []);
      setOnboard(d.recommendations?.stage === "interests");
      setRegistrationName(d.user.name === "Друг" ? "" : d.user.name || "");
      setRegistrationAge(d.user.profile?.age ? String(d.user.profile.age) : "");
      setFatal("");
    } catch (e) {
      setFatal(e.message);
    }
  }
  useEffect(() => {
    maxApp?.ready?.();
    maxApp?.expand?.();
    load();
    if (inviteCode)
      api("/invites/" + inviteCode)
        .then(setInvite)
        .catch((e) => setInviteError(e.message));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("first-step-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const back = () => {
      if (["garden", "map"].includes(tab) && !detail && !onboard && !settings) {
        go("home");
        return;
      }
      setDetail(null);
      if (data?.user?.interestOnboarded) setOnboard(false);
      setSettings(false);
    };
    if (detail || onboard || settings || ["garden", "map"].includes(tab)) {
      maxApp?.BackButton?.show?.();
      maxApp?.BackButton?.onClick?.(back);
    } else maxApp?.BackButton?.hide?.();
    return () => maxApp?.BackButton?.offClick?.(back);
  }, [tab, detail, onboard, settings, data?.user?.interestOnboarded]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [tab, detail, onboard, settings]);
  useEffect(() => {
    if (data?.recommendations?.stage === "feed") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [data?.recommendations?.stage, feedFilters.join("|"), audienceFilter, feedQuery]);
  useEffect(() => {
    const sentinel = feedSentinel.current;
    if (!sentinel || data?.recommendations?.stage !== "feed") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setFeedLimit((limit) => limit + 12);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [data?.recommendations?.stage]);
  async function act(fn) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Скопировано. Можно отправить, когда будешь готов.");
    } catch {
      setShare(text);
    }
  }
  function go(t) {
    const nextTab = t === "discover" || t === "together" ? "home" : t === "plan" ? "profile" : t;
    setTab(nextTab);
    setDetail(null);
    setOnboard(false);
    setSettings(false);
    setShare("");
  }
  async function save(patch) {
    await api("/profile", "PATCH", patch);
    await load();
  }
  async function plan(e) {
    await act(async () => {
      await api("/plans", "POST", {
        eventId: e.id,
        mode: profile.barrier === "company" ? "friend" : "solo",
      });
      await load();
      go("profile");
      setToast("Первый шаг сохранён. Начни с сообщения организатору.");
    });
  }
  async function inviteFromEvent(e) {
    await act(async () => {
      const p = await api("/plans", "POST", {
        eventId: e.id,
        mode: "friend",
      });
      const { code } = await api(`/plans/${p.id}/invite`, "POST", {});
      const url = data.botUsername
        ? `https://max.ru/${data.botUsername}?startapp=i_${code}`
        : `${location.origin}/?invite=${code}`;
      setShare(url);
      await copy(url);
      await load();
      setToast("Ссылка для друга готова и скопирована");
    });
  }
  async function update(id, patch) {
    await act(async () => {
      await api("/plans/" + id, "PATCH", patch);
      await load();
      if(patch.status === 'done') {
        go('garden');
        setToast('Новое растение в твоём саду · +100 воды' + (patch.hours ? ` · +${patch.hours * 50} солнца` : ''));
      } else setToast("План обновлён");
    });
  }
  async function inviteFriend(p) {
    await act(async () => {
      const { code } = await api(`/plans/${p.id}/invite`, "POST", {});
      const url = data.botUsername
        ? `https://max.ru/${data.botUsername}?startapp=i_${code}`
        : `${location.origin}/?invite=${code}`;
      setShare(url);
      await copy(url);
    });
  }
  if (fatal)
    return (
      <main className="error-page">
        <Sprout size={48} />
        <h1>Не получилось загрузить</h1>
        <p>{fatal}</p>
        <button onClick={load} className="primary">
          <RefreshCw size={18} /> Попробовать снова
        </button>
      </main>
    );
  if (!data)
    return (
      <main className="error-page">
        <Sprout className="loading" size={48} />
        <p>Готовим твой первый шаг…</p>
      </main>
    );
  const registrationAgeNumber = Number(registrationAge);
  const registrationValid = registrationName.trim().length >= 2
    && registrationName.trim().length <= 60
    && Number.isInteger(registrationAgeNumber)
    && registrationAgeNumber >= 7
    && registrationAgeNumber <= 100;
  if (!data.user.registered)
    return (
      <main className="registration-screen">
        <section className="registration-story">
          <div className="registration-brand"><Sprout size={25} /> первый шаг</div>
          <div className="registration-copy">
            <span className="eyebrow">ДАВАЙ ЗНАКОМИТЬСЯ · ШАГ 1 ИЗ 3</span>
            <h1>Сначала — немного о тебе</h1>
            <p>Имя сделает пространство личным, а возраст поможет сразу убрать дела с неподходящими ограничениями.</p>
          </div>
          <div className="registration-note">
            <ShieldCheck size={21} />
            <span>Возраст не показывается другим пользователям и нужен только для подбора событий.</span>
          </div>
          <Plant stage={2} />
        </section>
        <form className="registration-form" onSubmit={(event) => {
          event.preventDefault();
          if (!registrationValid) return;
          act(async () => {
            await api("/profile", "PATCH", { registration: { name: registrationName, age: registrationAgeNumber } });
            await load();
          });
        }}>
          <span className="registration-step">01 · ПРОФИЛЬ</span>
          <h2>Как к тебе обращаться?</h2>
          <label>
            Имя
            <input autoFocus autoComplete="name" maxLength={60} placeholder="Например, Маша" value={registrationName} onChange={(event) => setRegistrationName(event.target.value)} required />
          </label>
          <label>
            Сколько тебе лет?
            <input type="number" inputMode="numeric" min="7" max="100" step="1" placeholder="Например, 24" value={registrationAge} onChange={(event) => setRegistrationAge(event.target.value)} required />
          </label>
          <p className="registration-hint">Покажем события без ограничения или с минимальным возрастом не выше твоего.</p>
          <button className="primary" disabled={busy || !registrationValid}>Продолжить <ArrowRight size={18} /></button>
        </form>
        {toast && <div className="toast" role="status"><X size={17}/>{toast}</div>}
        {busy && <div className="busy" role="status">Сохраняем…</div>}
      </main>
    );
  const active = data.plans.filter(
    (p) => !["cancelled", "done"].includes(p.status),
  );
  const done = data.plans.filter((p) => p.status === "done");
  const chosen = data.catalog.filter(live);
  const catalogById = new Map(data.catalog.map((event) => [event.id, event]));
  const recommendations = data.recommendations || { stage: "interests" };
  const calibrationItem = recommendations.stage === "calibration"
    ? recommendations.items?.[recommendations.completed]
    : null;
  const dailyResponded = new Set(recommendations.daily?.feedback?.map((item) => item.eventId) || []);
  const dailyId = recommendations.daily?.ids?.find((id) => !dailyResponded.has(id));
  const swipeEvent = catalogById.get(calibrationItem?.id || dailyId);
  const swipeContext = recommendations.stage === "calibration" ? "calibration" : "daily";
  async function sendFeedback(action) {
    if (!swipeEvent || busy) return;
    setSwipeDrag(0);
    await act(async () => {
      const result = await api("/recommendations/feedback", "POST", { eventId: swipeEvent.id, action, context: swipeContext });
      setData((current) => ({ ...current, user: result.user, recommendations: result.recommendations }));
      setProfile(result.user.profile);
      if (swipeContext === "calibration" && result.recommendations.stage !== "calibration") setCalibrationDone(true);
    });
  }
  const nav = [
    ["home", Compass, "Добрые дела"],
    ["map", MapIcon, "Карта"],
    ["garden", Flower2, "Мой сад"],
    ["profile", UserRound, "Профиль"],
  ];
  const mobileNav = nav;
  function ThemeToggle({ floating = false }) {
    const dark = theme === "dark";
    return <button className={floating ? "theme-toggle floating-theme-toggle" : "theme-toggle"} aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"} title={dark ? "Светлая тема" : "Тёмная тема"} onClick={() => setTheme(dark ? "light" : "dark")}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>;
  }
  function BottomNav({ garden = false }) {
    return <nav className={garden ? "garden-nav" : "mobile-nav"} aria-label="Основная навигация">
      {mobileNav.map(([id, Icon, label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => go(id)}>
        <Icon size={21} />
        <span>{id === "home" ? "Дела" : label}</span>
        {id === "profile" && active.length > 0 && <i>{active.length}</i>}
      </button>)}
    </nav>;
  }
  function matchesFeedFilter(event, filter) {
    const annotation = event.annotation;
    if (annotation?.filterTags?.includes(filter)) return true;
    if (!annotation && filter === "remote") return event.traits?.format === "online";
    return false;
  }
  function matchesAudience(event, audience) {
    if (!audience) return true;
    const annotation = event.annotation;
    if (annotation?.beneficiaryGroups?.includes(audience)) return true;
    if (annotation?.causeAreas?.includes(audience)) return true;
    return audience === "animals" && event.themes?.includes("animals")
      || audience === "environment" && event.themes?.some((theme) => ["ecology", "nature", "recycling"].includes(theme));
  }
  function eventMatchesActiveFilters(event) {
    const query = feedQuery.trim().toLocaleLowerCase("ru-RU");
    const searchable = `${event.title} ${event.short} ${event.intro} ${event.annotation?.shortExplanation ?? ""} ${(event.annotation?.structuredTasks ?? []).join(" ")}`.toLocaleLowerCase("ru-RU");
    return (!query || searchable.includes(query))
      && feedFilters.every((filter) => matchesFeedFilter(event, filter))
      && matchesAudience(event, audienceFilter);
  }
  function toggleFeedFilter(filter) {
    setFeedFilters((current) => current.includes(filter)
      ? current.filter((item) => item !== filter)
      : [...current, filter]);
    setFeedLimit(12);
  }
  function Card({ e, featured = false }) {
    const annotation = e.annotation;
    const complexity = annotation?.complexity?.overall;
    return (
      <button
        className={`event-card ${featured ? "featured" : ""}`}
        style={complexityCardStyle(complexity)}
        onClick={() => setDetail(e)}
      >
        <div className="event-photo">
          {e.image ? (
            <img src={e.image} alt="" loading="lazy" />
          ) : (
            <Plant small />
          )}
          <span className="photo-tag">
            {e.category === "animals" ? (
              <Heart size={13} />
            ) : (
              <HandHeart size={13} />
            )}{" "}
            {themeTitle(e)}
          </span>
          <span className="photo-arrow">
            <ArrowUpRight size={19} />
          </span>
        </div>
        <div className="event-body">
          <h3>{e.short}</h3>
          <p>{annotation?.shortExplanation || e.intro}</p>
          {annotation && <div className="event-insights">
            <span className={`insight-chip ${complexity !== null && complexity <= 39 ? "easy" : ""}`}><Gauge size={12}/>{complexityText(complexity)}{complexity !== null ? ` · ${complexity}` : ""}</span>
            {annotation.firstTime?.verdict === "suitable" && <span className="insight-chip beginner"><Sprout size={12}/>Для первого раза · {annotation.firstTime.score}</span>}
            {annotation.quality?.status === "clarification_required" && <span className="insight-chip clarify">Есть что уточнить</span>}
          </div>}
          <div className="event-meta">
            <span>
              <MapPin size={14} />
              {e.city}
            </span>
            <span>{annotation ? commitmentLabels[annotation.participation?.commitment] : "Дату уточняем"}</span>
          </div>
        </div>
      </button>
    );
  }
  function CatalogFeed() {
    const sections = recommendations.sections || [{ id: "all", title: "Для тебя", subtitle: "Актуальные дела", eventIds: chosen.slice(0, 6).map((event) => event.id) }];
    const activeFilterCount = feedFilters.length + Number(Boolean(audienceFilter)) + Number(Boolean(feedQuery.trim()));
    const filteredEvents = chosen.filter(eventMatchesActiveFilters);
    const recommendedIds = new Set(activeFilterCount ? [] : sections.flatMap((section) => section.eventIds));
    const moreEvents = activeFilterCount ? filteredEvents : chosen.filter((event) => !recommendedIds.has(event.id));
    const visibleEvents = moreEvents.slice(0, feedLimit);
    return <section className="daily-feed">
      {recommendations.taste?.length > 0 && <div className="taste-row"><span>Сейчас тебе ближе:</span>{recommendations.taste.map((item) => <span className="taste-pill" key={item.id}>{themeMeta[item.id]?.[0]} {themeMeta[item.id]?.[1]} · {Math.round(item.weight * 100)}%</span>)}</div>}
      <section className="feed-filtering" aria-label="Фильтры добрых дел">
        <div className="feed-search-row">
          <label className="feed-search"><Search size={17}/><input value={feedQuery} onChange={(event) => { setFeedQuery(event.target.value); setFeedLimit(12); }} placeholder="Найти дело" aria-label="Поиск по добрым делам"/></label>
          <button className={`filter-toggle ${feedFiltersOpen ? "active" : ""}`} onClick={() => setFeedFiltersOpen((value) => !value)} aria-expanded={feedFiltersOpen}><SlidersHorizontal size={17}/>Фильтры{activeFilterCount > 0 && <i>{activeFilterCount}</i>}</button>
        </div>
        <div className="quick-filter-row">
          {quickFeedFilters.map(([id, label]) => <button key={id} className={feedFilters.includes(id) ? "active" : ""} aria-pressed={feedFilters.includes(id)} onClick={() => toggleFeedFilter(id)}>{label}</button>)}
        </div>
        <div className={`advanced-filters ${feedFiltersOpen ? "open" : ""}`}>
          <div><span>Кому помочь</span><div className="audience-options">{audienceFilters.map(([id, label]) => <button key={id} className={audienceFilter === id ? "active" : ""} aria-pressed={audienceFilter === id} onClick={() => { setAudienceFilter((current) => current === id ? "" : id); setFeedLimit(12); }}>{label}</button>)}</div></div>
          {activeFilterCount > 0 && <button className="reset-filters" onClick={() => { setFeedFilters([]); setAudienceFilter(""); setFeedQuery(""); setFeedLimit(12); }}>Сбросить всё <X size={14}/></button>}
        </div>
        {activeFilterCount > 0 && <div className="filter-result"><strong>{filteredEvents.length}</strong><span>{filteredEvents.length === 1 ? "подходящее дело" : "подходящих дел"}</span></div>}
      </section>
      {!activeFilterCount && <div className="feed-sections">
        {sections.map((section) => {
          const items = section.eventIds.map((id) => catalogById.get(id)).filter(Boolean);
          if (!items.length) return null;
          return <section className="feed-block" key={section.id}>
            <div className="section-head"><h2>{section.title}{section.id === "taste" ? " 🌱" : ""}</h2></div>
            <div className="feed-rail">{items.map((event) => <Card key={event.id} e={event}/>)}</div>
          </section>;
        })}
      </div>}
      {moreEvents.length > 0 && <section className="infinite-events">
        <div className="cards catalog">{visibleEvents.map((event) => <Card key={event.id} e={event}/>)}</div>
        {visibleEvents.length < moreEvents.length && <div className="feed-sentinel" ref={feedSentinel} aria-hidden="true"/>}
      </section>}
      {activeFilterCount > 0 && !moreEvents.length && <div className="feed-empty"><Sprout size={34}/><h2>Таких дел пока не нашли</h2><p>Убери один из фильтров — покажем ближайшие варианты.</p><button className="secondary" onClick={() => { setFeedFilters([]); setAudienceFilter(""); setFeedQuery(""); }}>Сбросить фильтры</button></div>}
    </section>;
  }
  function ProfilePage() {
    const interactions = data.user.recommendation?.interactions || [];
    const likedCount = interactions.filter((item) => item.action === "like").length;
    const skippedCount = interactions.filter((item) => item.action === "skip").length;
    const selectedInterests = new Set(profile.interests || []);
    const vectorTaste = Object.entries(data.user.recommendation?.vector || {})
      .filter(([key]) => key.startsWith("theme_"))
      .map(([key, weight]) => ({ id: key.slice(6), weight: Number(weight) || 0 }));
    const taste = (recommendations.taste?.length ? recommendations.taste : vectorTaste)
      .filter((item) => themeMeta[item.id])
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6);
    const likedEvents = [...interactions]
      .reverse()
      .filter((item) => item.action === "like")
      .map((item) => catalogById.get(item.eventId))
      .filter((event, index, list) => event && list.findIndex((candidate) => candidate.id === event.id) === index)
      .slice(0, 4);
    const ownPlans = data.plans.filter((item) => item.owner === data.user.id);
    const currentPlans = ownPlans.filter((item) => !["cancelled", "done"].includes(item.status));
    const completedPlans = ownPlans.filter((item) => item.status === "done");
    const achievements = [
      { title: "Выбрал направления", text: "Не меньше пяти тем для первой настройки", unlocked: selectedInterests.size >= 5, icon: Target },
      { title: "Настроил ленту", text: "Прошёл первые 12 выборов", unlocked: data.user.onboarded || interactions.filter((item) => item.context === "calibration").length >= 12, icon: SlidersHorizontal },
      { title: "Нашёл отклик", text: "Отметил первое подходящее дело", unlocked: likedCount > 0, icon: Heart },
      { title: "Составил план", text: "Сохранил дело и начал подготовку", unlocked: ownPlans.length > 0, icon: ListChecks },
      { title: "Сделал первый шаг", text: "Сохранил завершённое посещение", unlocked: completedPlans.length > 0, icon: Sprout },
      { title: "Сад растёт", text: "Завершил три разных добрых дела", unlocked: completedPlans.length >= 3, icon: Award },
    ];
    const unlockedCount = achievements.filter((item) => item.unlocked).length;
    return <section className="profile-page">
      <header className="profile-hero">
        <div className="profile-avatar">{data.user.name.slice(0, 1).toUpperCase()}</div>
        <div><span className="eyebrow">ТВОЙ ПУТЬ В ВОЛОНТЁРСТВЕ</span><h1>{data.user.name}</h1><p>{profile.city || "Москва"} · рекомендации меняются вместе с твоими выборами</p></div>
        <button className="profile-settings-button" aria-label="Настройки профиля" onClick={() => setSettings(true)}><Settings size={18}/></button>
      </header>

      <div className="profile-stat-strip" aria-label="Личная статистика">
        <div><strong>{likedCount}</strong><span>понравилось</span></div>
        <div><strong>{currentPlans.length}</strong><span>в плане</span></div>
        <div><strong>{completedPlans.length}</strong><span>завершено</span></div>
        <div><strong>{unlockedCount}/{achievements.length}</strong><span>достижений</span></div>
      </div>

      <section className="profile-section profile-taste">
        <div className="profile-section-heading"><div><span className="eyebrow">ТВОИ ИНТЕРЕСЫ</span><h2>Что тебе сейчас ближе</h2></div><button className="text-button" onClick={() => { setInterestSelection(profile.interests || []); setOnboard(true); }}>Изменить</button></div>
        <div className="profile-taste-list">{taste.map((item) => { const percentage = Math.round(item.weight * 100); return <div className="profile-taste-row" key={item.id}><span className="profile-taste-icon">{themeMeta[item.id][0]}</span><div><div><strong>{themeMeta[item.id][1]}</strong><span>{percentage}%{selectedInterests.has(item.id) ? " · выбрано тобой" : ""}</span></div><i><b style={{ width: `${percentage}%` }}/></i></div></div>; })}</div>
        {!taste.length && <p className="profile-empty-note">Выбери интересы — здесь появится понятная карта предпочтений.</p>}
      </section>

      <section className="profile-section">
        <div className="profile-section-heading"><div><span className="eyebrow">ПОЧЕМУ ТАКАЯ ЛЕНТА</span><h2>Из чего складываются рекомендации</h2></div></div>
        <div className="recommendation-reasons">
          <div><span>01</span><p><strong>Темы</strong> Учитываем {selectedInterests.size || "ещё не выбранные"} направлений, которые ты отметил в начале.</p></div>
          <div><span>02</span><p><strong>Твои реакции</strong> {likedCount} подходящих и {skippedCount} пропущенных дел уточняют формат, темп и темы.</p></div>
          <div><span>03</span><p><strong>Реальные шаги</strong> План и завершённое дело влияют сильнее обычного свайпа.</p></div>
          <div><span>04</span><p><strong>Условия</strong> Сложность, формат, длительность и возможность пойти вместе помогают поставить удобные дела выше.</p></div>
        </div>
      </section>

      <section className="profile-section profile-plan-full">
        <div className="profile-section-heading"><div><span className="eyebrow">МОЙ ПЛАН</span><h2>{active.length ? "Ближайшие шаги" : completedPlans.length ? "Твои завершённые дела" : "Первый план ещё впереди"}</h2></div></div>
        <p className="profile-section-intro">Здесь можно подготовиться, уточнить встречу, позвать друга и сохранить результат — всё прямо в профиле.</p>
        {active.length ? active.map((item) => <PlanItem key={item.id} p={item}/>) : <Empty title="Здесь появится твой план" text="Выбери одно дело. Мы поможем разобраться с деталями, написать организатору и позвать друга." />}
        {data.plans.some((item) => item.status === "cancelled") && <p className="notice">Ты отменил(а) прошлый план. Это нормально — следующее дело можно выбрать, когда будет удобно.</p>}
      </section>

      {likedEvents.length > 0 && <section className="profile-section"><div className="profile-section-heading"><div><span className="eyebrow">СОХРАНИЛОСЬ В ПАМЯТИ</span><h2>Дела, которые тебе понравились</h2></div></div><div className="profile-liked-list">{likedEvents.map((event) => <button key={event.id} onClick={() => setDetail(event)}><span>{themeMeta[event.theme]?.[0] || "🌱"}</span><div><strong>{event.short}</strong><small>{themeTitle(event)} · {event.city || (event.online ? "Онлайн" : "Место уточняется")}</small></div><ChevronRight size={17}/></button>)}</div></section>}

      <section className="profile-section">
        <div className="profile-section-heading"><div><h2>Достижения</h2></div></div>
        <div className="achievement-grid">{achievements.map(({ title, text, unlocked, icon: Icon }) => <div className={unlocked ? "achievement unlocked" : "achievement"} key={title}><span><Icon size={19}/></span><div><strong>{title}</strong><p>{text}</p></div>{unlocked && <Check size={16}/>}</div>)}</div>
      </section>
    </section>;
  }
  function SwipeExperience() {
    if (!swipeEvent) return <CatalogFeed />;
    const calibration = swipeContext === "calibration";
    const completed = calibration ? recommendations.completed : recommendations.daily.completed;
    const target = calibration ? recommendations.target : recommendations.daily.target;
    return <section className={`swipe-home ${calibration ? "calibration-swipe" : ""}`}>
      <div className="swipe-intro">
        <div><span className="eyebrow">{calibration ? "ШАГ 2 ИЗ 2 · НАСТРАИВАЕМ ТВОЙ ВКУС" : "РЕКОМЕНДАЦИИ НА СЕГОДНЯ"}</span><h1>{calibration ? "Куда ты действительно мог бы пойти?" : "Что откликается сегодня?"}</h1>{!calibration && <p>Каждый выбор помогает точнее собрать завтрашнюю подборку.</p>}</div>
        <span className="swipe-count">{completed + 1} / {target}</span>
      </div>
      <div className="swipe-progress" aria-label={`Пройдено ${completed} из ${target}`}>{Array.from({ length: target }, (_, index) => <span className={index < completed ? "done" : index === completed ? "current" : ""} key={index}/>)}</div>
      <div className="swipe-deck" onPointerDown={(event) => { setSwipeStart(event.clientX); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (swipeStart !== null) setSwipeDrag(event.clientX - swipeStart); }} onPointerUp={() => { if (Math.abs(swipeDrag) > 70) sendFeedback(swipeDrag > 0 ? "like" : "skip"); else setSwipeDrag(0); setSwipeStart(null); }} onPointerCancel={() => { setSwipeDrag(0); setSwipeStart(null); }}>
        <div className="swipe-home-card" style={{ transform: `translateX(${swipeDrag}px) rotate(${swipeDrag / 22}deg)` }}>
          <div className="swipe-home-media">{swipeEvent.image ? <img src={swipeEvent.image} alt=""/> : <Plant/>}<span className="swipe-home-label">{themeMeta[swipeEvent.theme]?.[0]} {themeTitle(swipeEvent)}</span>{Math.abs(swipeDrag) > 34 && <span className={`swipe-verdict ${swipeDrag > 0 ? "yes" : ""}`}>{swipeDrag > 0 ? "ХОЧУ" : "НЕ МОЁ"}</span>}</div>
          <div className="swipe-home-copy"><h2>{swipeEvent.short}</h2><div className="trait-row"><span>{swipeEvent.annotation?.format === "online" || (!swipeEvent.annotation && swipeEvent.traits?.format === "online") ? "Онлайн" : "На месте"}</span><span>{swipeEvent.annotation?.feedSignals?.friendsAllowed === "yes" ? "Можно вместе" : swipeEvent.annotation?.participation?.modes?.includes("solo") ? "Можно одному" : "Формат уточнить"}</span><span>{swipeEvent.annotation ? complexityText(swipeEvent.annotation.complexity.overall) : swipeEvent.traits?.duration === "short" ? "Около часа" : swipeEvent.traits?.duration === "long" ? "Регулярно" : "1–3 часа"}</span></div><button className="text-button" onClick={() => setDetail(swipeEvent)}>Подробнее <ArrowUpRight size={15}/></button></div>
        </div>
      </div>
      <div className="swipe-home-actions"><button className="swipe-round skip" disabled={busy} onClick={() => sendFeedback("skip")} aria-label="Не моё"><X size={22}/></button><button className="swipe-round like" disabled={busy} onClick={() => sendFeedback("like")} aria-label="Мне подходит"><Heart size={22}/></button></div>
    </section>;
  }
  function CalibrationComplete() {
    const top = recommendations.taste || [];
    return <section className="calibration-complete"><div className="complete-orbit"><Sprout size={42}/><span>✨</span></div><span className="eyebrow">ПРОФИЛЬ ГОТОВ</span><h1>Мы собрали твою ленту</h1>{top.length > 0 && <div className="taste-row">{top.map((item) => <span className="taste-pill" key={item.id}>{themeMeta[item.id]?.[0]} {themeMeta[item.id]?.[1]}</span>)}</div>}<button className="primary" onClick={() => setCalibrationDone(false)}>Посмотреть рекомендации <ArrowRight size={18}/></button></section>;
  }
  function Empty({
    title,
    text,
    action = "Найти своё дело",
    target = "discover",
  }) {
    return (
      <div className="empty">
        <Sprout size={38} />
        <h2>{title}</h2>
        <p>{text}</p>
        <button className="primary" onClick={() => go(target)}>
          {action}
          <ArrowRight size={17} />
        </button>
      </div>
    );
  }
  function PlanItem({ p }) {
    const owner = p.owner === data.user.id;
    const [when, setWhen] = useState(
        p.when
          ? new Date(Date.parse(p.when) + 3 * 3600000)
              .toISOString()
              .slice(0, 16)
          : "",
      ),
      [meeting, setMeeting] = useState(p.meeting),
      [confirmed, setConfirmed] = useState(p.confirmed),
      [cancel, setCancel] = useState(false),
      [hours, setHours] = useState('');
    return (
      <article className="plan-item">
        <div className="plan-cover">
          <span className="eyebrow">
            {owner ? "ТВОЙ ПЕРВЫЙ ШАГ" : "ВЫ ИДЁТЕ ВМЕСТЕ"}
          </span>
          <h2>{p.event.short}</h2>
          <p>
            <CalendarDays size={17} />
            {dateLabel(p.when)}
          </p>
          <span className="pill">
            {p.status === "ready"
              ? "Согласование отмечено тобой"
              : "Ожидает согласования"}
          </span>
        </div>
        <div className="plan-content">
          <div className="section-head">
            <h3>До встречи — три маленьких шага</h3>
            <span>{p.checks.length}/3</span>
          </div>
          {[
            [
              "contact",
              "Написать организатору",
              "Согласуй дату, задачи и длительность.",
            ],
            [
              "route",
              "Узнать, где встретят",
              "Точный адрес, имя координатора и ориентир.",
            ],
            [
              "bag",
              "Подготовиться без спешки",
              "Уточни одежду, документы и что взять с собой.",
            ],
          ].map(([id, title, text], i) => (
            <div className="check-row" key={id}>
              <button
                disabled={!owner || busy}
                aria-label={title}
                aria-pressed={p.checks.includes(id)}
                className={"check " + (p.checks.includes(id) ? "checked" : "")}
                onClick={() =>
                  update(p.id, {
                    checks: p.checks.includes(id)
                      ? p.checks.filter((x) => x !== id)
                      : [...p.checks, id],
                  })
                }
              >
                {p.checks.includes(id) ? <Check size={17} /> : i + 1}
              </button>
              <div>
                <strong>{title}</strong>
                <p>{text}</p>
                {id === "contact" && (
                  <button
                    className="text-button"
                    onClick={() => setDetail(p.event)}
                  >
                    Подготовить сообщение <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <hr />
          <h3>Конкретный план помогает дойти</h3>
          <p className="muted">
            Заполни после ответа организатора. Это личный план, а не запись на
            мероприятие.
          </p>
          {owner ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                update(p.id, {
                  when: when
                    ? new Date(when + ":00+03:00").toISOString()
                    : null,
                  meeting,
                  confirmed,
                });
              }}
            >
              <label>
                Дата и время · Москва (UTC+3)
                <input
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  required
                />
              </label>
              <label>
                Где встречаемся и кто встретит
                <input
                  placeholder="Например: у входа, координатор Анна"
                  maxLength={240}
                  value={meeting}
                  onChange={(e) => setMeeting(e.target.value)}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Я согласовал(а) визит с организатором
              </label>
              <button className="primary" disabled={busy}>
                Сохранить договорённость <Check size={16} />
              </button>
            </form>
          ) : (
            <p className="notice">
              {p.meeting || "Автор приглашения пока не указал место встречи."}{" "}
              Каждый участник отдельно уточняет регистрацию у организатора.
            </p>
          )}
          <hr />
          <div className="section-head">
            <h3>Свой человек рядом</h3>
            <Users size={20} />
          </div>
          <p className="muted">
            {p.members.length
              ? `В компании: ${p.members.map((m) => m.name).join(", ")}.`
              : "Друг ещё не присоединился. Пригласи того, с кем тебе спокойно."}
          </p>
          {owner ? (
            <div className="button-row">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => inviteFriend(p)}
              >
                <Plus size={16} />
                Пригласить друга
              </button>
              <button
                className="text-button"
                onClick={() =>
                  act(async () => {
                    await api(`/plans/${p.id}/invite`, "DELETE", {});
                    setShare("");
                    setToast("Ссылки приглашения отозваны");
                  })
                }
              >
                Отозвать ссылку
              </button>
            </div>
          ) : (
            <button
              className="secondary"
              onClick={() =>
                act(async () => {
                  await api(`/plans/${p.id}/leave`, "POST", {});
                  await load();
                })
              }
            >
              Выйти из компании
            </button>
          )}
          {share && (
            <label className="share-box">
              Отправь другу лично. Ссылка действует 7 дней.
              <textarea readOnly value={share} />
            </label>
          )}
          {p.when && (
            <button
              className="text-button calendar-link"
              onClick={() => {
                const dt = new Date(p.when)
                  .toISOString()
                  .replace(/[-:]/g, "")
                  .replace(/\.\d{3}Z$/, "Z");
                const esc = (v) =>
                  String(v)
                    .replaceAll("\\", "\\\\")
                    .replaceAll("\n", "\\n")
                    .replaceAll(",", "\\,")
                    .replaceAll(";", "\\;");
                const blob = new Blob(
                  [
                    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//First Step//RU\r\nBEGIN:VEVENT\r\nUID:${p.id}@firststep\r\nDTSTAMP:${new Date()
                      .toISOString()
                      .replace(/[-:]/g, "")
                      .replace(
                        /\.\d{3}Z$/,
                        "Z",
                      )}\r\nDTSTART:${dt}\r\nSUMMARY:${esc(p.event.short)}\r\nDESCRIPTION:${esc("Личный план. Участие согласовать с организатором. " + p.event.url)}\r\nLOCATION:${esc(p.meeting)}\r\nEND:VEVENT\r\nEND:VCALENDAR`,
                  ],
                  { type: "text/calendar;charset=utf-8" },
                );
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "perviy-shag.ics";
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
              }}
            >
              <CalendarDays size={17} />
              Добавить в календарь
            </button>
          )}
          {owner && (
            <>
              <hr />
              {p.confirmed && p.when && Date.parse(p.when) <= Date.now() ? (
                <div>
                  <h3>Как всё прошло?</h3>
                  <label>Сколько часов ты помогал(а)? Необязательно.
                    <input type="number" min="0" max="24" step="0.5" value={hours} placeholder="Например, 2" onChange={e=>setHours(e.target.value)}/>
                  </label>
                  <p className="muted">
                    Твоя отметка останется личной. Это не подтверждение
                    волонтёрских часов.
                  </p>
                  <div className="button-row">
                    {[
                      ["warm", "Было тепло"],
                      ["okay", "Нормально"],
                      ["hard", "Было непросто"],
                    ].map(([v, t]) => (
                      <button
                        className="secondary"
                        key={v}
                        onClick={() =>
                          update(p.id, { status: "done", reflection: v, hours: hours === '' ? 0 : Number(hours) })
                        }
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="muted small-text">
                  После согласованной даты здесь можно будет сохранить
                  впечатление и вырастить полноценное растение в саду.
                </p>
              )}
              {cancel ? (
                <div className="notice">
                  <p>
                    Отменить личный план? Если ты уже записался, отдельно
                    предупреди организатора и друга.
                  </p>
                  <div className="button-row">
                    <button
                      className="secondary"
                      onClick={() => update(p.id, { status: "cancelled" })}
                    >
                      Да, отменить
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setCancel(false)}
                    >
                      Оставить план
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="text-button cancel"
                  onClick={() => setCancel(true)}
                >
                  Сейчас не получается — отменить план
                </button>
              )}
            </>
          )}
        </div>
      </article>
    );
  }
  let content;
  if (invite || inviteError)
    content = (
      <>
        <button
          className="back"
          onClick={() => {
            setInvite(null);
            setInviteError("");
            history.replaceState(null, "", "/");
          }}
        >
          <ArrowLeft size={17} />К приложению
        </button>
        <div className="invite-page">
          <Users size={42} />
          <span className="eyebrow">ПЕРВЫЙ ШАГ ЛЕГЧЕ ВМЕСТЕ</span>
          <h1>
            {inviteError
              ? "Ссылка больше не действует"
              : `${invite.ownerName} зовёт тебя помочь`}
          </h1>
          <p>{inviteError || invite.event.short}</p>
          {invite && (
            <>
              <p>{dateLabel(invite.when)}</p>
              <p className="notice">
                Приняв приглашение, ты откроешь другу своё имя в MAX.
                Точное место встречи станет доступно участникам. Регистрация на
                ДОБРО остаётся отдельным шагом.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await api("/invites/" + inviteCode, "POST", {});
                    await load();
                    setInvite(null);
                    history.replaceState(null, "", "/");
                    go("profile");
                  })
                }
              >
                {invite.joined ? "Открыть общий план" : "Пойду вместе"}
                <ArrowRight size={17} />
              </button>
            </>
          )}
        </div>
      </>
    );
  else if (settings)
    content = (
      <>
        <button className="back" onClick={() => setSettings(false)}>
          <ArrowLeft size={17} />
          Назад
        </button>
        <h1>В твоём темпе</h1>
        <p className="lead">Ты решаешь, когда возвращаться и чем делиться.</p>
        <div className="settings-panel">
          <h3>Напоминание перед визитом</h3>
          <p>
            Одно сообщение в MAX за сутки или ближе к согласованному
            времени. Включается только по твоему выбору.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              disabled={data.mode === "demo" || busy}
              checked={data.user.reminders}
              onChange={(e) =>
                act(() => save({ reminders: e.target.checked }))
              }
            />
            Напомнить в MAX
          </label>
          {data.mode === "demo" && (
            <p className="small-text muted">
              Доступно после подключения бота и команды /start.
            </p>
          )}
          <hr />
          <h3>Твои данные</h3>
          <p>
            Храним имя, возраст, предпочтения и личные планы. Возраст используем
            только для фильтра ограничений. Друг видит имя и общий план
            только после принятия приглашения. Геопозицию и адресную книгу не
            запрашиваем.
          </p>
          <form className="personal-form" onSubmit={(event) => {
            event.preventDefault();
            if (!registrationValid) return;
            act(async () => {
              await save({ registration: { name: registrationName, age: registrationAgeNumber } });
              setToast("Имя и возраст обновлены");
            });
          }}>
            <label>Имя<input autoComplete="name" maxLength={60} value={registrationName} onChange={(event) => setRegistrationName(event.target.value)} required /></label>
            <label>Возраст<input type="number" inputMode="numeric" min="7" max="100" step="1" value={registrationAge} onChange={(event) => setRegistrationAge(event.target.value)} required /></label>
            <button className="secondary" disabled={busy || !registrationValid}>Сохранить личные данные</button>
          </form>
          <button
            className="secondary"
            onClick={() => {
              setOnboard(true);
              setSettings(false);
              setInterestSelection(profile.interests || []);
            }}
          >
            Изменить предпочтения
          </button>
          <details>
            <summary>Удалить профиль и планы</summary>
            <p>
              Действие удалит твой профиль, созданные планы и участие в
              компаниях.
            </p>
            <button
              className="secondary"
              onClick={() =>
                act(async () => {
                  await api("/me", "DELETE", {});
                  await load();
                  go("home");
                  setToast("Данные удалены");
                })
              }
            >
              Удалить мои данные
            </button>
          </details>
        </div>
      </>
    );
  else if (onboard)
    content = (
      <div className="interest-onboarding" role="dialog" aria-modal="true" aria-labelledby="interest-title">
        <section className="interest-panel">
          {data.user.interestOnboarded && <button className="interest-close" aria-label="Закрыть" onClick={() => setOnboard(false)}><X size={19} /></button>}
          <div className="interest-copy"><span className="eyebrow">ДАВАЙ ЗНАКОМИТЬСЯ · ШАГ 1 ИЗ 2</span><h1 id="interest-title">Что тебе близко?</h1><p>Выбери минимум 5 тем. Это даст ленте хорошую отправную точку.</p></div>
          <div className="interest-grid">
            {interestOptions.map(([id, emoji, title, description], index) => {
              const selected = interestSelection.includes(id);
              const source = data.catalog.find((event) => event.theme === id)?.image || data.catalog[index % data.catalog.length]?.image;
              return <button key={id} className={`interest-card ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={() => setInterestSelection((current) => selected ? current.filter((item) => item !== id) : [...current, id])}>
                <span className="interest-image" style={{ backgroundImage: source ? `url(${source})` : undefined }}><span className="interest-tint" /><span className="interest-emoji">{emoji}</span>{selected && <span className="interest-check"><Check size={14} strokeWidth={3} /></span>}</span>
                <span className="interest-title">{title}</span><span className="interest-description">{description}</span>
              </button>;
            })}
          </div>
          <div className="interest-actions"><span>{interestSelection.length < 5 ? `Выбери ещё ${5 - interestSelection.length}` : `Выбрано: ${interestSelection.length}`}</span><button className="primary" disabled={busy || interestSelection.length < 5} onClick={() => act(async () => { await api("/profile", "PATCH", { interests: interestSelection }); await load(); setFeedLimit(12); setOnboard(false); setCalibrationDone(false); go("home"); })}>Настроить ленту <ArrowRight size={18} /></button></div>
        </section>
      </div>
    );
  else if (detail)
    content = (
      <>
        <button className="back" onClick={() => setDetail(null)}>
          <ArrowLeft size={17} />{tab === "map" ? "К карте" : "К добрым делам"}
        </button>
        <article className="detail">
          <div className="detail-image">
            {detail.image && <img src={detail.image} alt={detail.short} />}
            <span className="photo-tag">{themeTitle(detail)}</span>
          </div>
          <div className="detail-main">
            <span className="eyebrow">{detail.city} · ДОБРО</span>
            <h1>{detail.short}</h1>
            <p className="lead">{detail.intro}</p>
            <div className="source-note">
              <ShieldCheck size={21} />
              <div>
                <strong>{detail.support}</strong>
                <p>{detail.why}</p>
              </div>
            </div>
            {detail.annotation && <section className="fit-panel">
              <div className="fit-heading">
                <div><span className="eyebrow">РАЗМЕТКА УСЛОВИЙ</span><h2>Подойдёт ли мне?</h2></div>
                <span className={`quality-mark ${detail.annotation.quality.status === "suitable" ? "ready" : "ask"}`}>{detail.annotation.quality.status === "suitable" ? "Можно показывать" : "Нужно уточнить"}</span>
              </div>
              <div className="fit-scores">
                <div className="fit-score"><span>Для первого раза</span><strong>{detail.annotation.firstTime.score ?? "—"}<small>/100</small></strong><div className="score-track" aria-hidden="true"><i style={{ width: `${detail.annotation.firstTime.score ?? 0}%` }}/></div></div>
                <div className="fit-score complexity"><span>Сложность</span><strong>{detail.annotation.complexity.overall ?? "—"}<small>/100</small></strong><div className="score-track" aria-hidden="true"><i style={{ width: `${detail.annotation.complexity.overall ?? 0}%` }}/></div></div>
                <div className="fit-fact"><span>Формат</span><strong>{formatLabels[detail.annotation.format] || "Уточняется"}</strong></div>
                <div className="fit-fact"><span>Участие</span><strong>{commitmentLabels[detail.annotation.participation.commitment]}</strong></div>
              </div>
              <p className="fit-explanation">{detail.annotation.firstTime.explanation}</p>
              {detail.annotation.firstTime.positives.length > 0 && <div className="fit-list good"><span>Что помогает начать</span><div>{detail.annotation.firstTime.positives.slice(0, 5).map((item) => <i key={item}><Check size={13}/>{positiveLabels[item] || item}</i>)}</div></div>}
              {detail.annotation.firstTime.concerns.length > 0 && <div className="fit-list concern"><span>Что учесть</span><div>{detail.annotation.firstTime.concerns.slice(0, 4).map((item) => <i key={item}>{concernLabels[item] || item}</i>)}</div></div>}
              {detail.annotation.requirements.unknownConditions.length > 0 && <p className="ask-ahead"><MessageCircle size={16}/><span><strong>Спроси заранее:</strong> {detail.annotation.requirements.unknownConditions.slice(0, 5).map((item) => unknownLabels[item] || item).join(", ")}.</span></p>}
              <details className="annotation-details">
                <summary>Все условия дела <ChevronRight size={16}/></summary>
                <div className="annotation-details-body">
                  {detail.annotation.structuredTasks.length > 0 && <div className="annotation-task-list"><span>Что предстоит делать</span><ul>{detail.annotation.structuredTasks.slice(0, 6).map((task) => <li key={task}>{task}</li>)}</ul></div>}
                  <div className="annotation-axis-grid">
                    {complexityAxes.map(([key, label]) => <div key={key}><span>{label}</span><strong>{annotationValueLabels[detail.annotation.complexity[key]] || detail.annotation.complexity[key]}</strong></div>)}
                    <div><span>Можно участвовать</span><strong>{detail.annotation.participation.modes.map((item) => annotationValueLabels[item] || item).join(", ")}</strong></div>
                  </div>
                  {(detail.annotation.requirements.ownResources.length > 0 || detail.annotation.requirements.additionalPrerequisites.length > 0) && <div className="annotation-requirements">
                    {detail.annotation.requirements.ownResources.length > 0 && <p><span>Понадобится:</span> {detail.annotation.requirements.ownResources.map((item) => annotationValueLabels[item] || item).join(", ")}.</p>}
                    {detail.annotation.requirements.additionalPrerequisites.length > 0 && <p><span>Перед участием:</span> {detail.annotation.requirements.additionalPrerequisites.map((item) => annotationValueLabels[item] || item).join(", ")}.</p>}
                  </div>}
                </div>
              </details>
              {detail.annotation.alternativesCount > 1 && <p className="vacancy-note">У события есть ещё {detail.annotation.alternativesCount - 1} {detail.annotation.alternativesCount === 2 ? "роль" : "роли"}. Мы показываем наиболее подходящую для первого шага.</p>}
            </section>}
            <h2>Как сделать первый шаг</h2>
            <ol className="first-steps">
              <li>
                <span>01</span>
                <div>
                  <strong>Сначала познакомиться</strong>
                  <p>{detail.first}</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Договориться о понятном визите</strong>
                  <p>
                    Спроси о задачах, длительности, ограничениях и человеке,
                    который встретит. Короткое знакомство возможно только с
                    согласия организатора.
                  </p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Прийти в своём темпе</strong>
                  <p>
                    Позови друга, если так спокойнее. Предупреди координатора,
                    что вы придёте вдвоём.
                  </p>
                </div>
              </li>
            </ol>
            <div className="message-draft">
              <div className="section-head">
                <h3>
                  <MessageCircle size={19} />
                  Первое сообщение уже готово
                </h3>
                <Copy size={18} />
              </div>
              <p>{`Здравствуйте! Хочу впервые помочь: «${detail.title}». Можно ли прийти новичку? Какие задачи, сколько длится смена, что взять с собой и кто меня встретит? Можно ли прийти с другом? Есть ли ограничения по возрасту или здоровью?`}</p>
              <button
                className="secondary"
                onClick={() =>
                  copy(
                    `Здравствуйте! Хочу впервые помочь: «${detail.title}». Можно ли прийти новичку? Какие задачи, сколько длится смена, что взять с собой и кто меня встретит? Можно ли прийти с другом? Есть ли ограничения по возрасту или здоровью?`,
                  )
                }
              >
                Скопировать сообщение <Copy size={15} />
              </button>
              <a href={detail.url} target="_blank" rel="noreferrer">
                Контакты и запись на ДОБРО <ExternalLink size={15} />
              </a>
            </div>
            <h3>Что известно из источника</h3>
            <dl className="facts">
              <div>
                <dt>Адрес в карточке</dt>
                <dd>{detail.address}</dd>
              </div>
              <div>
                <dt>Период программы</dt>
                <dd>
                  {new Date(detail.startsAt).toLocaleDateString("ru-RU")} —{" "}
                  {new Date(detail.endsAt).toLocaleDateString("ru-RU")}
                </dd>
              </div>
              <div>
                <dt>Длительность и возраст</dt>
                <dd>{detail.annotation?.facts?.exactDurationMinutes ? `${detail.annotation.facts.exactDurationMinutes} мин.` : "Длительность уточняется"}{detail.annotation?.facts?.minimumAge ? ` · ${detail.annotation.facts.minimumAge}+` : ""}</dd>
              </div>
            </dl>
            <p className="small-text muted">
              Выгрузка от 9 сентября 2026. Период программы не означает
              ежедневные смены. Свободные места и актуальные условия проверяй на
              странице организатора.
            </p>
            <details>
              <summary>Оригинальное описание ДОБРО</summary>
              <p className="original">{detail.description}</p>
              <a href={detail.url} target="_blank" rel="noreferrer">
                Открыть источник <ExternalLink size={14} />
              </a>
            </details>
            <div className="detail-action">
              <div className="detail-action-buttons">
                <button
                  className="primary"
                  disabled={busy || !live(detail)}
                  onClick={() => plan(detail)}
                >
                  {live(detail) ? "Это мой первый шаг" : "Событие завершилось"}
                  <ArrowRight size={18} />
                </button>
                <button
                  className="secondary"
                  disabled={busy || !live(detail)}
                  onClick={() => inviteFromEvent(detail)}
                >
                  <Users size={17}/>
                  Позвать друга
                </button>
              </div>
              <span>
                Сохраним личный план.
                <br />
                Это ещё не регистрация.
              </span>
            </div>
            {share && <label className="share-box detail-share-box">Ссылка-приглашение действует 7 дней.<textarea readOnly value={share}/><button className="secondary" onClick={() => copy(share)}><Copy size={15}/>Скопировать ещё раз</button></label>}
          </div>
        </article>
      </>
    );
  else if (tab === "home")
    content = calibrationDone ? <CalibrationComplete /> : ["calibration", "daily"].includes(recommendations.stage) ? <SwipeExperience /> : <CatalogFeed />;
  else if (tab === "map")
    content = <MapErrorBoundary><Suspense fallback={<div className="map-loading">Открываем карту…</div>}><VolunteerMap events={chosen} onSelect={setDetail}/></Suspense></MapErrorBoundary>;
  else if (tab === "profile")
    content = <ProfilePage />;
  else content = <Garden data={data} />;
  const cleanScreen = !detail && !onboard && !settings && !invite && !inviteError;
  if (tab === "garden" && cleanScreen)
    return <div className="garden-only-shell"><Garden data={data} /><BottomNav garden /></div>;
  if (tab === "map" && cleanScreen)
    return <div className="map-only-shell"><ThemeToggle floating/><MapErrorBoundary><Suspense fallback={<div className="map-loading">Открываем карту…</div>}><VolunteerMap events={chosen} onSelect={setDetail}/></Suspense></MapErrorBoundary><BottomNav garden /></div>;
  if (tab === "home" && cleanScreen && (calibrationDone || ["calibration", "daily"].includes(recommendations.stage)))
    return <div className="swipe-only-shell"><ThemeToggle floating/>{calibrationDone ? <CalibrationComplete /> : <SwipeExperience />}{toast && <div className="toast" role="status"><Check size={18}/>{toast}<button aria-label="Закрыть уведомление" onClick={() => setToast("")}><X size={16}/></button></div>}</div>;
  return (
    <div className="app">
      <aside className="sidebar">
        <button className="brand" onClick={() => go("home")}>
          <span className="brand-icon">
            <Sprout size={25} />
          </span>
          <span>
            первый шаг<span className="brand-sub">начать помогать — проще</span>
          </span>
        </button>
        <nav aria-label="Основная навигация">
          {nav.map(([id, I, label]) => (
            <button
              className={
                tab === id && !detail && !onboard && !settings
                  ? "nav-item active"
                  : "nav-item"
              }
              key={id}
              onClick={() => go(id)}
            >
              <I size={20} />
              {label}
              {id === "profile" && active.length > 0 && (
                <span className="nav-count">{active.length}</span>
              )}
            </button>
          ))}
        </nav>
        <button
          className="profile-button"
          onClick={() => {
            setSettings(true);
            setDetail(null);
            setOnboard(false);
          }}
        >
          <span className="avatar">{data.user.name.slice(0, 1)}</span>
          <span>
            {data.mode === "demo" ? "Гость" : data.user.name}
            <small>
              {data.mode === "demo"
                ? "Локальный деморежим"
                : "Моё пространство"}
            </small>
          </span>
          <Settings size={17} />
        </button>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="mobile-brand">
            <Sprout size={21} />
            первый шаг
          </span>
          <div>
             <span className="location">
              <MapPin size={15} />
               Москва
             </span>
             <ThemeToggle />
            <button
              className="top-settings"
              aria-label="Настройки"
              onClick={() => {
                setSettings(true);
                setDetail(null);
                setOnboard(false);
              }}
            >
              <Settings size={18} />
            </button>
          </div>
        </header>
        <main
          className="main"
          key={detail?.id || `${tab}-${onboard}-${settings}`}
        >
          {content}
        </main>
        <footer className="app-footer">
          <span>Первый шаг © 2026</span>
          <span>Реальные дела · данные ДОБРО</span>
        </footer>
      </div>
      <BottomNav />
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button aria-label="Закрыть уведомление" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy" role="status">
          Сохраняем…
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
