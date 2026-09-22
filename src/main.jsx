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
  ChevronDown,
  Copy,
  ExternalLink,
  Plus,
  Sprout,
  HandHeart,
  BookOpen,
  X,
  Settings,
  ShieldCheck,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Moon,
  Sun,
  UserRound,
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

function HelpiWordmark({ className = "" }) {
  return (
    <span className={`helpi-wordmark ${className}`.trim()}>хелпи</span>
  );
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
const audienceFilters = [
  ["animals", "Животные"],
  ["children", "Дети"],
  ["elderly_people", "Пожилые"],
  ["people_with_disabilities", "Люди с инвалидностью"],
  ["military_personnel", "Военнослужащие"],
  ["environment", "Природа"],
  ["nonprofit_organizations", "НКО"],
];
const cityOptions = [
  { name: "Москва", center: [37.6173, 55.7558], aliases: ["москва"] },
  { name: "Санкт-Петербург", center: [30.3159, 59.9391], aliases: ["санкт-петербург", "петербург", "спб"] },
  { name: "Казань", center: [49.1064, 55.7961], aliases: ["казан"] },
  { name: "Рыбинск", center: [38.8584, 58.0484], aliases: ["рыбинск"] },
];
const cityNames = new Set(cityOptions.map((city) => city.name));
const normalizedPlace = (value) => String(value || "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
const eventIsOnline = (event) => ["online", "remote"].includes(event.annotation?.format || event.traits?.format)
  || /онлайн|дистанцион/.test(normalizedPlace(`${event.city} ${event.address} ${event.support}`));
const eventMatchesCity = (event, cityName, includeOnline = true) => {
  if (includeOnline && eventIsOnline(event)) return true;
  const option = cityOptions.find((city) => city.name === cityName) || cityOptions[0];
  const place = normalizedPlace(`${event.city} ${event.address}`);
  return option.aliases.some((alias) => place.includes(alias));
};
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
  const color = value <= 20
    ? "oklch(82% .17 125)"
    : value <= 40
      ? "hsl(76 82% 48%)"
      : value <= 60
        ? "hsl(50 94% 52%)"
        : value <= 80
          ? "hsl(18 88% 60%)"
          : "hsl(0 88% 57%)";
  return { "--difficulty-color": color };
};
const commitmentLabels = {
  one_off: "Один визит", multiple_visits: "Несколько встреч", regular: "Регулярно",
  flexible: "Гибко", unknown: "По договорённости",
};
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
      if (requested === "plan" || requested === "garden") return "profile";
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
    [audienceFilter, setAudienceFilter] = useState(""),
    [difficultyFilter, setDifficultyFilter] = useState(""),
    [dateFilter, setDateFilter] = useState(""),
    [timeFilter, setTimeFilter] = useState(""),
    [formatFilter, setFormatFilter] = useState(""),
    [feedQuery, setFeedQuery] = useState(""),
    [feedFiltersOpen, setFeedFiltersOpen] = useState(false),
    [registrationName, setRegistrationName] = useState(""),
    [registrationAge, setRegistrationAge] = useState(""),
    [selectedCity, setSelectedCity] = useState(() => {
      const saved = localStorage.getItem("helpi-city");
      return cityNames.has(saved) ? saved : "Москва";
    }),
    [theme, setTheme] = useState(() => localStorage.getItem("first-step-theme") || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const [swipeDrag, setSwipeDrag] = useState(0),
    [swipeStart, setSwipeStart] = useState(null);
  const feedSentinel = useRef(null);
  const cityPickerRef = useRef(null);
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
    localStorage.setItem("helpi-city", selectedCity);
  }, [selectedCity]);
  useEffect(() => {
    const closeCityPicker = (event) => {
      if (!cityPickerRef.current?.contains(event.target)) cityPickerRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeCityPicker);
    return () => document.removeEventListener("pointerdown", closeCityPicker);
  }, []);
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
  }, [data?.recommendations?.stage, audienceFilter, difficultyFilter, dateFilter, timeFilter, formatFilter, feedQuery]);
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
    const nextTab = t === "discover" || t === "together" ? "home" : ["plan", "garden"].includes(t) ? "profile" : t;
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
        go('profile');
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
          <div className="registration-brand"><HelpiWordmark /></div>
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
  const liveCatalog = data.catalog.filter(live);
  const chosen = liveCatalog.filter((event) => eventMatchesCity(event, selectedCity));
  const mapEvents = liveCatalog.filter((event) => eventMatchesCity(event, selectedCity, false));
  const catalogById = new Map(data.catalog.map((event) => [event.id, event]));
  const cityCatalogById = new Map(chosen.map((event) => [event.id, event]));
  const selectedCityOption = cityOptions.find((city) => city.name === selectedCity) || cityOptions[0];
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
    ["profile", UserRound, "Профиль"],
  ];
  const mobileNav = nav;
  function CityPicker() {
    async function chooseCity(name) {
      cityPickerRef.current?.removeAttribute("open");
      if (name === selectedCity) return;
      setSelectedCity(name);
      setFeedLimit(12);
      setDetail(null);
      await act(async () => {
        const user = await api("/profile", "PATCH", { city: name });
        setData((current) => ({ ...current, user }));
        setProfile(user.profile);
      });
    }
    return <details className="city-picker" ref={cityPickerRef}>
      <summary aria-label={`Город: ${selectedCity}. Изменить город`}>
        <MapPin size={15}/><span>{selectedCity}</span><ChevronDown size={14}/>
      </summary>
      <div className="city-menu" role="menu" aria-label="Выбор города">
        {cityOptions.map((city) => <button type="button" role="menuitemradio" aria-checked={city.name === selectedCity} className={city.name === selectedCity ? "active" : ""} key={city.name} onClick={() => chooseCity(city.name)}>
          <span>{city.name}</span>{city.name === selectedCity && <Check size={15}/>}
        </button>)}
      </div>
    </details>;
  }
  function ThemeToggle({ floating = false }) {
    const dark = theme === "dark";
    return <button className={floating ? "theme-toggle floating-theme-toggle" : "theme-toggle"} aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"} title={dark ? "Светлая тема" : "Тёмная тема"} onClick={() => setTheme(dark ? "light" : "dark")}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>;
  }
  function BottomNav({ garden = false }) {
    return <nav className={garden ? "garden-nav" : "mobile-nav"} aria-label="Основная навигация">
      {mobileNav.map(([id, Icon, label]) => <button className={`${tab === id ? "active " : ""}nav-${id}`} key={id} onClick={() => go(id)}>
        <Icon size={21} />
        <span>{id === "home" ? "Дела" : label}</span>
        {id === "profile" && active.length > 0 && <i>{active.length}</i>}
      </button>)}
    </nav>;
  }
  function matchesAudience(event, audience) {
    if (!audience) return true;
    const annotation = event.annotation;
    if (annotation?.beneficiaryGroups?.includes(audience)) return true;
    if (annotation?.causeAreas?.includes(audience)) return true;
    return audience === "animals" && event.themes?.includes("animals")
      || audience === "environment" && event.themes?.some((theme) => ["ecology", "nature", "recycling"].includes(theme));
  }
  function matchesDifficulty(event, difficulty) {
    if (!difficulty) return true;
    const score = event.annotation?.complexity?.overall;
    if (!Number.isFinite(score)) return false;
    if (difficulty === "easy") return score < 40;
    if (difficulty === "medium") return score >= 40 && score < 70;
    return score >= 70;
  }
  function matchesDate(event, date) {
    if (!date) return true;
    const dayStart = Date.parse(`${date}T00:00:00+03:00`);
    const dayEnd = dayStart + 86_400_000 - 1;
    return Date.parse(event.startsAt) <= dayEnd && Date.parse(event.endsAt) >= dayStart;
  }
  function matchesTime(event, period) {
    if (!period) return true;
    const parsed = new Date(event.startsAt);
    if (Number.isNaN(parsed.getTime())) return false;
    const moscowHour = (parsed.getUTCHours() + 3) % 24;
    if (period === "morning") return moscowHour >= 6 && moscowHour < 12;
    if (period === "day") return moscowHour >= 12 && moscowHour < 18;
    return moscowHour >= 18 || moscowHour < 6;
  }
  function matchesFormat(event, format) {
    if (!format) return true;
    const eventFormat = event.annotation?.format || event.traits?.format;
    return format === "online"
      ? eventFormat === "online"
      : ["on_site", "offline", "field_trip", "hybrid"].includes(eventFormat);
  }
  function eventMatchesActiveFilters(event) {
    const query = feedQuery.trim().toLocaleLowerCase("ru-RU");
    const searchable = `${event.title} ${event.short} ${event.intro} ${event.annotation?.shortExplanation ?? ""} ${(event.annotation?.structuredTasks ?? []).join(" ")}`.toLocaleLowerCase("ru-RU");
    return (!query || searchable.includes(query))
      && matchesAudience(event, audienceFilter)
      && matchesDifficulty(event, difficultyFilter)
      && matchesDate(event, dateFilter)
      && matchesTime(event, timeFilter)
      && matchesFormat(event, formatFilter);
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
          {annotation && (annotation.firstTime?.verdict === "suitable" || annotation.quality?.status === "clarification_required") && <div className="event-insights">
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
    const activeFilterCount = [audienceFilter, difficultyFilter, dateFilter, timeFilter, formatFilter, feedQuery.trim()].filter(Boolean).length;
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
        <div className={`advanced-filters ${feedFiltersOpen ? "open" : ""}`}>
          <div className="filter-groups">
            <div className="filter-group"><span>Сложность</span><div className="filter-options">{[["easy", "Легко"], ["medium", "Средне"], ["hard", "Сложно"]].map(([id, label]) => <button key={id} className={difficultyFilter === id ? "active" : ""} aria-pressed={difficultyFilter === id} onClick={() => { setDifficultyFilter((current) => current === id ? "" : id); setFeedLimit(12); }}>{label}</button>)}</div></div>
            <label className="filter-group filter-date"><span>Дата</span><input type="date" value={dateFilter} onChange={(event) => { setDateFilter(event.target.value); setFeedLimit(12); }}/></label>
            <div className="filter-group"><span>Время</span><div className="filter-options">{[["morning", "Утро"], ["day", "День"], ["evening", "Вечер"]].map(([id, label]) => <button key={id} className={timeFilter === id ? "active" : ""} aria-pressed={timeFilter === id} onClick={() => { setTimeFilter((current) => current === id ? "" : id); setFeedLimit(12); }}>{label}</button>)}</div></div>
            <div className="filter-group"><span>Формат</span><div className="filter-options">{[["on_site", "На месте"], ["online", "Онлайн"]].map(([id, label]) => <button key={id} className={formatFilter === id ? "active" : ""} aria-pressed={formatFilter === id} onClick={() => { setFormatFilter((current) => current === id ? "" : id); setFeedLimit(12); }}>{label}</button>)}</div></div>
            <div className="filter-group filter-audience"><span>Кому помочь</span><div className="filter-options">{audienceFilters.map(([id, label]) => <button key={id} className={audienceFilter === id ? "active" : ""} aria-pressed={audienceFilter === id} onClick={() => { setAudienceFilter((current) => current === id ? "" : id); setFeedLimit(12); }}>{label}</button>)}</div></div>
          </div>
          {activeFilterCount > 0 && <button className="reset-filters" onClick={() => { setDifficultyFilter(""); setDateFilter(""); setTimeFilter(""); setFormatFilter(""); setAudienceFilter(""); setFeedQuery(""); setFeedLimit(12); }}>Сбросить всё <X size={14}/></button>}
        </div>
        {activeFilterCount > 0 && <div className="filter-result"><strong>{filteredEvents.length}</strong><span>{filteredEvents.length === 1 ? "подходящее дело" : "подходящих дел"}</span></div>}
      </section>
      {!activeFilterCount && <div className="feed-sections">
        {sections.map((section) => {
          const items = section.eventIds.map((id) => cityCatalogById.get(id)).filter(Boolean);
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
      {activeFilterCount > 0 && !moreEvents.length && <div className="feed-empty"><Sprout size={34}/><h2>Таких дел пока не нашли</h2><p>Убери один из фильтров — покажем ближайшие варианты.</p><button className="secondary" onClick={() => { setDifficultyFilter(""); setDateFilter(""); setTimeFilter(""); setFormatFilter(""); setAudienceFilter(""); setFeedQuery(""); }}>Сбросить фильтры</button></div>}
    </section>;
  }
  function ProfilePage() {
    const completedCount = data.plans.filter((item) => item.owner === data.user.id && item.status === "done").length;
    const lastDigit = completedCount % 10;
    const lastTwo = completedCount % 100;
    const deedLabel = lastDigit === 1 && lastTwo !== 11
      ? "доброе дело"
      : [2, 3, 4].includes(lastDigit) && !(lastTwo >= 12 && lastTwo <= 14)
        ? "добрых дела"
        : "добрых дел";
    const displayName = data.user.name || "Друг";
    return <section className="profile-garden-page" aria-label="Профиль и личный сад">
      <Garden data={data}/>
      <header className="profile-garden-hud">
        <div className="profile-hud-person">
          <span className="profile-hud-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
          <strong>{displayName}</strong>
        </div>
        <div className="profile-hud-deeds" aria-label={`${completedCount} ${deedLabel}`}>
          <span className="profile-hud-sprout" aria-hidden="true"><Sprout size={24}/></span>
          <strong>{completedCount}</strong>
          <span>{deedLabel}</span>
        </div>
      </header>
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
            <dl className="facts">
              <div>
                <dt>Адрес</dt>
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
                <dt>Длительность</dt>
                <dd>{detail.annotation?.facts?.exactDurationMinutes ? `${detail.annotation.facts.exactDurationMinutes} мин.` : "Не указана"}</dd>
              </div>
              <div>
                <dt>Возраст</dt>
                <dd>{detail.annotation?.facts?.minimumAge ? `${detail.annotation.facts.minimumAge}+` : "Не указан"}</dd>
              </div>
            </dl>
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
    content = <MapErrorBoundary><Suspense fallback={<div className="map-loading">Открываем карту…</div>}><VolunteerMap key={selectedCity} events={mapEvents} center={selectedCityOption.center} onSelect={setDetail}/></Suspense></MapErrorBoundary>;
  else if (tab === "profile")
    content = <ProfilePage />;
  else content = <CatalogFeed />;
  const cleanScreen = !detail && !onboard && !settings && !invite && !inviteError;
  if (tab === "profile" && cleanScreen)
    return <div className="profile-garden-shell"><ProfilePage /><BottomNav garden /></div>;
  if (tab === "map" && cleanScreen)
    return <div className="map-only-shell"><ThemeToggle floating/><MapErrorBoundary><Suspense fallback={<div className="map-loading">Открываем карту…</div>}><VolunteerMap key={selectedCity} events={mapEvents} center={selectedCityOption.center} onSelect={setDetail}/></Suspense></MapErrorBoundary><BottomNav garden /></div>;
  if (tab === "home" && cleanScreen && (calibrationDone || ["calibration", "daily"].includes(recommendations.stage)))
    return <div className="swipe-only-shell"><ThemeToggle floating/>{calibrationDone ? <CalibrationComplete /> : <SwipeExperience />}{toast && <div className="toast" role="status"><Check size={18}/>{toast}<button aria-label="Закрыть уведомление" onClick={() => setToast("")}><X size={16}/></button></div>}</div>;
  return (
    <div className="app">
      <aside className="sidebar">
        <button className="brand" aria-label="хелпи — на главную" onClick={() => go("home")}>
          <HelpiWordmark />
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
          <span className="mobile-brand"><HelpiWordmark /></span>
          <div>
             <CityPicker />
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
          <span>хелпи © 2026</span>
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
