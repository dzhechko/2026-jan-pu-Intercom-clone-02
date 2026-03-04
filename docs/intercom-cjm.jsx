import { useState } from "react";

/* ═══════════════════════════════════════════════════════
   CJM PROTOTYPE: Российский аналог Intercom
   Company: Intercom → Clone "КоммуниQ" (Customer AI Platform)
   Industry: Customer Communication Platform / Support SaaS
   Geography: Россия / СНГ
   Mode: DEEP
   Generated from M1+M2 analysis
═══════════════════════════════════════════════════════ */

const COMPANY = "КоммуниQ";
const TAGLINE = "AI-платформа клиентских коммуникаций для СНГ-рынка";

const VARIANTS = {
  A: {
    name: "AI-Агент",
    emoji: "🤖",
    color: "#2563eb",
    bg: "bg-blue-50", bdr: "border-blue-200", txt: "text-blue-700",
    accent: "bg-blue-600 text-white",
    accentHover: "hover:bg-blue-700",
    badge: "bg-blue-100 text-blue-800",
    tagline: "AI закрывает тикеты — ты занимаешься бизнесом",
    hypothesis: "AI auto-resolution = главный WOW = конверсия",
    segment: "SaaS стартапы / PLG компании",
    risk: "Нужен confidence threshold — AI иногда ошибается",

    landing: {
      hl: "Масштабируй поддержку без найма агентов",
      sub: "AI-агент отвечает на 60%+ обращений за секунды. Команда занимается только сложными задачами.",
      cta: "Подключить AI-агента бесплатно",
      proof: ["Внедрение за 15 минут", "60%+ авто-решений с первой недели", "Без кода — загрузи FAQ"],
    },

    onboarding: {
      style: "Guided Setup Wizard — 3 шага",
      q1: "Вставьте код виджета на сайт (или выберите вашу CMS)",
      q2: "Загрузите FAQ или базу знаний (PDF, Notion, Google Docs)",
      q3: "AI обучается — первые авто-ответы через 10 минут",
      progress: ["Виджет подключён ✅", "База знаний загружена ✅", "AI обучается... 73%"],
    },

    aha: {
      title: "🤖 AI закрыл 3 тикета пока вы пили кофе",
      subtitle: "За последний час — без единого агента",
      tickets: [
        { q: "Как сменить тариф?", a: "AI ответил за 4 сек", conf: "97%", status: "✅ Закрыт" },
        { q: "Где скачать счёт?", a: "AI ответил за 2 сек", conf: "99%", status: "✅ Закрыт" },
        { q: "Интеграция с 1С?", a: "Передано агенту", conf: "41%", status: "👤 Человек" },
      ],
      kpi: "62% обращений закрыто AI сегодня",
      wow: "Команда из 2 агентов справляется с нагрузкой 10",
    },

    dash: {
      hook: "AI Performance Dashboard",
      stats: [
        { label: "AI-решений сегодня", val: "62%", trend: "↑ +8% vs прошлая неделя", color: "text-blue-600" },
        { label: "Среднее время ответа", val: "4 сек", trend: "↓ было 3.5 часа", color: "text-emerald-600" },
        { label: "Агентов задействовано", val: "2/6", trend: "Остальные свободны", color: "text-violet-600" },
        { label: "CSAT", val: "4.7 / 5", trend: "↑ +0.4 с внедрением AI", color: "text-amber-600" },
      ],
      ai_queue: "3 активных | 17 AI-закрытых | 0 просроченных",
    },

    pay: {
      when: "После первых AI-закрытых тикетов (день 1)",
      frame: "Wow-момент → апгрейд на эмоции",
      trigger: "Попытка настроить второй канал или посмотреть аналитику AI",
      offer: "Старт: ₽1 490/мес — безлимит AI + 3 агента",
      anchor: "vs Intercom $85/мес × курс = ₽7 800 — сэкономьте 80%",
      urgency: "Цена фиксируется на 12 мес при оплате сейчас",
    },

    inv: {
      hook: "«Мой AI ответил клиенту в 2:30 ночи»",
      mech: "Поделись скриншотом AI-статистики → +1 месяц бесплатно для тебя и друга",
      viral: "«Работает на КоммуниQ» в подписи виджета (бесплатный план)",
    },
  },

  B: {
    name: "Проактив",
    emoji: "📡",
    color: "#059669",
    bg: "bg-emerald-50", bdr: "border-emerald-200", txt: "text-emerald-700",
    accent: "bg-emerald-600 text-white",
    accentHover: "hover:bg-emerald-700",
    badge: "bg-emerald-100 text-emerald-800",
    tagline: "Пиши клиентам первым — до того, как они уйдут",
    hypothesis: "Проактивность = дифференциатор vs Zendesk/JivoChat",
    segment: "Product-Led Growth B2B, онбординг",
    risk: "Триггеры сложно настроить — нужен guided setup",

    landing: {
      hl: "Перестань тушить пожары — предупреждай их",
      sub: "Поведенческие триггеры + AI пишут клиентам первыми. Конверсия растёт, отток — падает.",
      cta: "Настроить первый триггер",
      proof: ["Первый триггер за 5 минут", "Рост конверсии фри→пейд на 34%", "Снижение churn на 28%"],
    },

    onboarding: {
      style: "Trigger Builder — визуальный конструктор",
      q1: "Выберите событие-триггер: зашёл на pricing / провёл 3+ сессии / не логинился 7 дней",
      q2: "Настройте сообщение: AI-генерация или свой шаблон",
      q3: "Включите триггер — первое сообщение уйдёт автоматически",
      progress: ["Триггер создан ✅", "Аудитория: 47 пользователей подходят", "Отправка: авто при следующем событии"],
    },

    aha: {
      title: "📡 Вы написали клиенту — до того, как он позвонил",
      subtitle: "Триггер «Не оплатил после пробного периода» — сработал",
      tickets: [
        { q: "👤 Алексей Иванов — trial истёк 2 дня назад", a: "Отправлено: «Заметили, что вы не завершили настройку...»", conf: "—", status: "💬 Ответил через 12 мин" },
        { q: "👤 ООО «Ромашка» — 3 сессии без оплаты", a: "Отправлено: «Нужна помощь с выбором тарифа?»", conf: "—", status: "✅ Оформили подписку" },
        { q: "👤 Команда Петрова — не заходили 8 дней", a: "Отправлено: «Что-то пошло не так? Расскажите нам»", conf: "—", status: "💬 Дали обратную связь" },
      ],
      kpi: "34% конверсия из триггерных сообщений",
      wow: "3 потенциальных churner сохранены — без звонков от команды",
    },

    dash: {
      hook: "Proactive Engagement Hub",
      stats: [
        { label: "Активных триггеров", val: "12", trend: "Работают 24/7", color: "text-emerald-600" },
        { label: "Конверсия из триггеров", val: "34%", trend: "↑ Среднее по SaaS: 18%", color: "text-blue-600" },
        { label: "Churners спасено / мес", val: "23", trend: "≈ ₽345 000 ARR сохранено", color: "text-amber-600" },
        { label: "NPS после проактива", val: "+47", trend: "↑ +12 vs контрольная группа", color: "text-violet-600" },
      ],
      ai_queue: "12 триггеров активны | 89 сообщений вчера | 3 новых конверсии",
    },

    pay: {
      when: "После настройки первого триггера (proof of concept)",
      frame: "Клиент видит конкретный результат → апгрейд логичен",
      trigger: "Попытка создать второй триггер или посмотреть аналитику кампаний",
      offer: "Рост: ₽2 990/мес — безлимит триггеров + AI + 5 агентов",
      anchor: "Один спасённый churner окупает месяц подписки",
      urgency: "A/B-тестирование триггеров — только в платном плане",
    },

    inv: {
      hook: "«Мы уведомили 120 клиентов до инцидента — покажу как»",
      mech: "Case study шаблон → поделись с коллегой → оба получают +14 дней",
      viral: "«Отправлено через КоммуниQ» + ссылка в проактивных сообщениях",
    },
  },

  C: {
    name: "Единое Окно",
    emoji: "🪟",
    color: "#7c3aed",
    bg: "bg-violet-50", bdr: "border-violet-200", txt: "text-violet-700",
    accent: "bg-violet-600 text-white",
    accentHover: "hover:bg-violet-700",
    badge: "bg-violet-100 text-violet-800",
    tagline: "Все клиентские каналы в одном месте — история не теряется",
    hypothesis: "All-in-one контекст = retention anchor + enterprise-look",
    segment: "Mid-market CS Teams, 10-100 агентов",
    risk: "Setup 2-4 недели — нужен fast time-to-value",

    landing: {
      hl: "Выгляди как enterprise-команда — с первого дня",
      sub: "Чат + email + Telegram + ВКонтакте в одном inbox. История клиента всегда под рукой. AI помогает отвечать.",
      cta: "Подключить все каналы",
      proof: ["ВКонтакте + Telegram из коробки", "Единый inbox для всей команды", "История клиента за 2 клика"],
    },

    onboarding: {
      style: "Channel Connector — пошаговое подключение",
      q1: "Подключите каналы: чат на сайте / email / Telegram / ВКонтакте / WhatsApp",
      q2: "Пригласите команду (роли: агент, супервизор, аналитик)",
      q3: "Импортируйте историю: CSV из старой системы или API",
      progress: ["Чат + Telegram подключены ✅", "Команда: 4 агента ✅", "Импорт истории: 2 340 контактов ✅"],
    },

    aha: {
      title: "🪟 Клиент написал в Telegram — ты ответил из единого inbox",
      subtitle: "История: 3 предыдущих обращения + открытые заказы + NPS",
      tickets: [
        { q: "📱 Telegram: «Где мой заказ №8821?»", a: "Агент видит: заказ + статус + история + NPS 3/10", conf: "—", status: "✅ Ответил за 45 сек" },
        { q: "✉️ Email: «Хочу вернуть товар»", a: "AI предложил шаблон возврата с учётом истории", conf: "88%", status: "✅ Закрыт AI-шаблоном" },
        { q: "💬 ВКонтакте: «Долго ждать менеджера»", a: "Авто-ответ + эскалация супервизору", conf: "—", status: "👁 Мониторинг" },
      ],
      kpi: "1 агент вместо 3 — благодаря единому контексту",
      wow: "Время ответа: 45 сек (было: 2.5 часа из разных систем)",
    },

    dash: {
      hook: "Unified Inbox Command Center",
      stats: [
        { label: "Активных каналов", val: "5", trend: "Чат + Email + TG + VK + WhatsApp", color: "text-violet-600" },
        { label: "Avg. время ответа", val: "1.8 мин", trend: "↓ было 2.5 часа (всё разрозненно)", color: "text-emerald-600" },
        { label: "Дубликатов избежано", val: "34/нед", trend: "Клиент не пишет дважды", color: "text-blue-600" },
        { label: "SLA выполнено", val: "96%", trend: "↑ +23% vs старая система", color: "text-amber-600" },
      ],
      ai_queue: "5 каналов | 12 активных | 0 без ответа > 5 мин",
    },

    pay: {
      when: "После 14 дней (привычка + ROI очевиден)",
      frame: "Команда уже не может без единого inbox → апгрейд = продление статус-кво",
      trigger: "Исчерпан лимит историй или попытка подключить 4-й канал",
      offer: "Бизнес: ₽3 490/мес — 5 каналов + AI + безлимит агентов",
      anchor: "ROI-калькулятор: экономия 4.2 часа/агент/день × команда 5 = ₽47 000/мес",
      urgency: "Историю контактов можно экспортировать только из платного плана",
    },

    inv: {
      hook: "«Вся команда видит одно — хаоса нет»",
      mech: "Пригласи коллегу → оба получают +1 агентское место бесплатно на 3 мес",
      viral: "«Powered by КоммуниQ» в email подписи и чат-виджете (free tier)",
    },
  },
};

const CJM_META = {
  landing:   { stage: "Awareness",    aarrr: "Acquisition",       q: "Релевантен ли hook для сегмента?" },
  onboarding:{ stage: "Activation",   aarrr: "Activation",        q: "Дошёл ли до первого успеха (<10 мин)?" },
  aha:       { stage: "Aha Moment",   aarrr: "Activation",        q: "Получил ли клиент WOW без помощи?" },
  dash:      { stage: "Engagement",   aarrr: "Retention",         q: "Возвращается ли ежедневно?" },
  pay:       { stage: "Monetization", aarrr: "Revenue",           q: "Понятна ли ценность ДО paywall?" },
  inv:       { stage: "Referral",     aarrr: "Referral",          q: "Рекомендует ли органически?" },
};

const SCREENS   = ["landing","onboarding","aha","dash","pay","inv"];
const SCREEN_LBL = { landing:"Вход", onboarding:"Онбординг", aha:"Aha Moment", dash:"Dashboard", pay:"Монетизация", inv:"Реферал" };

/* ── Comparison rows ── */
const COMPARE_ROWS = [
  { l: "Aha Moment",       fn: (v) => v.aha.title.replace(/[🤖📡🪟]/gu,"").trim() },
  { l: "Entry Hook",       fn: (v) => v.landing.hl },
  { l: "Сегмент",          fn: (v) => v.segment },
  { l: "Онбординг",        fn: (v) => v.onboarding.style },
  { l: "Paywall триггер",  fn: (v) => v.pay.when },
  { l: "Гипотеза",         fn: (v) => v.hypothesis },
  { l: "Главный риск",     fn: (v) => v.risk },
  { l: "Реферальный крюк", fn: (v) => v.inv.hook },
];

/* ── Screen Card ── */
function ScreenCard({ vk, sk, showMeta }) {
  const v   = VARIANTS[vk];
  const meta = CJM_META[sk];

  const body = () => {
    switch (sk) {
      case "landing": return (
        <div className="space-y-4">
          <h3 className="text-xl font-bold text-gray-900 leading-tight">{v.landing.hl}</h3>
          <p className="text-sm text-gray-600 leading-relaxed">{v.landing.sub}</p>
          <div className="space-y-1.5">
            {v.landing.proof.map((p,i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                <span className="text-emerald-500 font-bold">✓</span>{p}
              </div>
            ))}
          </div>
          <button className={`w-full py-3 rounded-xl font-semibold text-sm ${v.accent} shadow-md`}>
            {v.landing.cta} →
          </button>
          <p className="text-[10px] text-center text-gray-400">14 дней бесплатно · Без карты · Отмена в любой момент</p>
        </div>
      );

      case "onboarding": return (
        <div className="space-y-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">{v.onboarding.style}</p>
          {[v.onboarding.q1, v.onboarding.q2, v.onboarding.q3].map((q, i) => (
            <div key={i} className={`p-3 rounded-xl border ${v.bdr} ${v.bg}`}>
              <div className="flex items-start gap-2">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 ${v.accent}`}>{i+1}</span>
                <p className="text-sm text-gray-700">{q}</p>
              </div>
            </div>
          ))}
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <p className="text-[10px] text-gray-500 font-semibold mb-1.5">Прогресс</p>
            {v.onboarding.progress.map((p,i) => (
              <p key={i} className="text-xs text-gray-600">{p}</p>
            ))}
          </div>
        </div>
      );

      case "aha": return (
        <div className="space-y-3">
          <div className={`p-3 rounded-xl text-center ${v.accent} shadow-sm`}>
            <p className="font-bold text-sm">{v.aha.title}</p>
            <p className="text-[11px] opacity-80 mt-0.5">{v.aha.subtitle}</p>
          </div>
          <div className="space-y-2">
            {v.aha.tickets.map((t,i) => (
              <div key={i} className={`p-2.5 rounded-xl border ${v.bdr} ${v.bg} text-xs space-y-1`}>
                <p className="font-semibold text-gray-800">{t.q}</p>
                <div className="flex items-center justify-between">
                  <p className="text-gray-500 text-[11px]">{t.a}</p>
                  <span className="font-bold text-gray-700">{t.status}</span>
                </div>
                {t.conf !== "—" && <p className="text-[10px] text-gray-400">Confidence AI: {t.conf}</p>}
              </div>
            ))}
          </div>
          <div className="p-2.5 rounded-xl bg-green-50 border border-green-200 text-center">
            <p className="text-sm font-bold text-green-800">{v.aha.kpi}</p>
            <p className="text-xs text-green-600 mt-0.5">{v.aha.wow}</p>
          </div>
        </div>
      );

      case "dash": return (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className={`font-bold text-sm ${v.txt}`}>{v.dash.hook}</h4>
            <span className="text-[10px] text-gray-400">Обновление: только что</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {v.dash.stats.map((s,i) => (
              <div key={i} className="p-2.5 rounded-xl bg-white border border-gray-100 shadow-sm">
                <p className={`text-lg font-bold ${s.color}`}>{s.val}</p>
                <p className="text-[10px] text-gray-500 leading-tight">{s.label}</p>
                <p className="text-[9px] text-gray-400 mt-0.5">{s.trend}</p>
              </div>
            ))}
          </div>
          <div className={`p-2 rounded-xl ${v.bg} border ${v.bdr} text-[11px] ${v.txt} font-mono`}>
            {v.dash.ai_queue}
          </div>
        </div>
      );

      case "pay": return (
        <div className="space-y-3">
          <div className={`p-3 rounded-xl ${v.bg} border ${v.bdr}`}>
            <p className={`text-xs font-bold ${v.txt} mb-1`}>⏱ Когда paywall?</p>
            <p className="text-sm text-gray-700">{v.pay.when}</p>
          </div>
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-xs font-bold text-amber-800 mb-1">💡 Фрейминг</p>
            <p className="text-sm text-gray-700">{v.pay.frame}</p>
          </div>
          <div className="p-3 rounded-xl bg-green-50 border border-green-200">
            <p className="text-xl font-bold text-green-800">{v.pay.offer}</p>
            <p className="text-xs text-green-600 mt-1">{v.pay.anchor}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-red-50 border border-red-200">
            <p className="text-xs text-red-700">⚡ {v.pay.urgency}</p>
          </div>
        </div>
      );

      case "inv": return (
        <div className="space-y-3">
          <div className={`p-3 rounded-xl ${v.accent} text-center`}>
            <p className="font-bold text-sm">{v.inv.hook}</p>
          </div>
          <div className={`p-3 rounded-xl border ${v.bdr} ${v.bg}`}>
            <p className="text-xs font-bold text-gray-700 mb-1">🎁 Реферальная механика</p>
            <p className="text-sm text-gray-600">{v.inv.mech}</p>
          </div>
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <p className="text-xs font-bold text-gray-600 mb-1">📣 Вирусный механизм</p>
            <p className="text-sm text-gray-500">{v.inv.viral}</p>
          </div>
        </div>
      );
      default: return null;
    }
  };

  return (
    <div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 min-h-[340px]">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{SCREEN_LBL[sk]}</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${v.badge}`}>{v.emoji} {v.name}</span>
        </div>
        {body()}
      </div>
      {showMeta && (
        <div className="mt-2 p-3 rounded-xl bg-gray-900 text-gray-300 text-[11px] space-y-1">
          <div className="flex justify-between"><span className="text-gray-500">Stage:</span><span>{meta.stage}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">AARRR:</span><span>{meta.aarrr}</span></div>
          <p className="text-gray-500 italic mt-1">❓ Custdev: {meta.q}</p>
        </div>
      )}
    </div>
  );
}

/* ── Compare Table ── */
function CompareTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="text-left p-3 text-gray-500 font-semibold w-[20%]">Параметр</th>
            {Object.entries(VARIANTS).map(([k,v]) => (
              <th key={k} className={`text-left p-3 font-semibold ${v.txt}`}>{v.emoji} {v.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map((r,i) => (
            <tr key={i} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
              <td className="p-3 font-semibold text-gray-600">{r.l}</td>
              {Object.values(VARIANTS).map((v,j) => (
                <td key={j} className="p-3 text-gray-700 leading-snug">{r.fn(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Scoring Cards ── */
function ScoringCards({ scores, setScores }) {
  const criteria = [
    { id:"fit",   l:"Fit с сегментом" },
    { id:"wow",   l:"Wow-момент" },
    { id:"easy",  l:"Простота онбординга" },
    { id:"pay",   l:"Логика монетизации" },
    { id:"viral", l:"Вирусность" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-gray-800">🏆 Оценка вариантов</h3>
        <p className="text-xs text-gray-400">Нажмите ★ для оценки 1-5</p>
      </div>
      {Object.entries(VARIANTS).map(([vk, v]) => {
        const total = criteria.reduce((s,c) => s + (scores[`${vk}-${c.id}`] || 0), 0);
        return (
          <div key={vk} className={`p-4 rounded-2xl border-2 ${v.bdr} ${v.bg}`}>
            <div className="flex items-center justify-between mb-3">
              <h4 className={`font-bold ${v.txt}`}>{v.emoji} Вариант {vk}: {v.name}</h4>
              <span className={`text-sm font-bold ${v.txt}`}>{total}/{criteria.length * 5}</span>
            </div>
            {criteria.map(c => {
              const key = `${vk}-${c.id}`;
              const val = scores[key] || 0;
              return (
                <div key={c.id} className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] text-gray-600 w-36 flex-shrink-0">{c.l}</span>
                  <div className="flex gap-0.5">
                    {[1,2,3,4,5].map(n => (
                      <button key={n} onClick={() => setScores(p => ({...p,[key]:n}))}
                        className={`w-6 h-6 rounded text-[11px] font-bold transition-all ${n <= val ? `${v.accent}` : "bg-white border border-gray-200 text-gray-300 hover:border-gray-400"}`}>
                        ★
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <p className="text-[10px] text-gray-500 mt-2 italic">{v.tagline}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ── Locked Result ── */
function LockedResult({ vk, onBack }) {
  const v = VARIANTS[vk];
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl p-8 max-w-lg w-full text-center space-y-6">
        <div className="text-7xl">{v.emoji}</div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Выбран вариант {vk}: «{v.name}»</h2>
          <p className={`text-sm font-medium mt-1 ${v.txt}`}>{v.tagline}</p>
        </div>
        <div className={`p-4 rounded-2xl border-2 ${v.bdr} ${v.bg} text-left space-y-2`}>
          <p className="text-xs font-bold text-gray-600">✅ Зафиксировано для M3-M6:</p>
          <p className="text-sm text-gray-700"><strong>Aha:</strong> {v.aha.title.replace(/[🤖📡🪟]/gu,"").trim()}</p>
          <p className="text-sm text-gray-700"><strong>Сегмент:</strong> {v.segment}</p>
          <p className="text-sm text-gray-700"><strong>Paywall:</strong> {v.pay.when}</p>
          <p className="text-sm text-gray-700"><strong>Виральность:</strong> {v.inv.hook}</p>
        </div>
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-left">
          <p className="text-xs font-bold text-amber-800 mb-2">🎯 Гипотеза для M3-M6:</p>
          <p className="text-sm text-amber-700">{v.hypothesis}</p>
          <p className="text-sm text-red-600 mt-1">⚠️ Риск: {v.risk}</p>
        </div>
        <p className="text-xs text-gray-400">Этот выбор будет использован как основа для конкурентного анализа (M3), юнит-экономики (M4), движка роста (M5) и 90-дневного playbook (M6).</p>
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600 underline">
          ← Изменить выбор
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════ */
export default function IntercomCJM() {
  const [av, setAv] = useState("A");
  const [si, setSi] = useState(0);
  const [showMeta, setShowMeta] = useState(false);
  const [view, setView] = useState("screens");   // screens | compare | score
  const [scores, setScores] = useState({});
  const [locked, setLocked] = useState(null);

  if (locked) return <LockedResult vk={locked} onBack={() => setLocked(null)} />;

  const v = VARIANTS[av];

  return (
    <div className="min-h-screen bg-slate-50 font-sans">

      {/* ── HEADER ── */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3">

          {/* Top row */}
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">💬</span>
                <h1 className="text-base font-bold text-gray-900">{COMPANY} — CJM Prototype</h1>
                <span className="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-semibold">M2.5 • DEEP</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">{TAGLINE} · 3 варианта × 6 экранов</p>
            </div>
            <button onClick={() => setShowMeta(!showMeta)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${showMeta ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              📊 Custdev
            </button>
          </div>

          {/* Variant tabs */}
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {Object.entries(VARIANTS).map(([k, var_]) => (
              <button key={k} onClick={() => { setAv(k); setView("screens"); }}
                className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                  av === k ? `${var_.accent} shadow-md` : `bg-white border border-gray-200 text-gray-500 hover:border-gray-400`
                }`}>
                {var_.emoji} {k}: {var_.name}
                {av === k && <span className="ml-1 opacity-70">← активен</span>}
              </button>
            ))}
          </div>

          {/* View tabs */}
          <div className="flex gap-1 mt-2 border-t border-gray-100 pt-2">
            {[
              { id:"screens", i:"📱", l:"Экраны" },
              { id:"compare", i:"⚖️", l:"Сравнение" },
              { id:"score",   i:"🏆", l:"Оценка" },
            ].map(t => (
              <button key={t.id} onClick={() => setView(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  view === t.id ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
                }`}>
                {t.i} {t.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="max-w-4xl mx-auto px-4 py-6">

        {/* SCREENS VIEW */}
        {view === "screens" && <>

          {/* Variant summary strip */}
          <div className={`p-3 rounded-2xl mb-5 border ${v.bdr} ${v.bg}`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className={`text-xs font-bold uppercase tracking-wider ${v.txt}`}>Вариант {av} · {v.name} {v.emoji}</p>
                <p className="text-sm font-semibold text-gray-800 mt-0.5">{v.landing.hl}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Сегмент: {v.segment}</p>
              </div>
              <div className="text-right text-[10px] text-gray-500">
                <p>Гипотеза:</p>
                <p className="font-semibold text-gray-700 max-w-[200px] text-right">{v.hypothesis}</p>
              </div>
            </div>
          </div>

          {/* Screen nav */}
          <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1">
            {SCREENS.map((s,i) => (
              <button key={s} onClick={() => setSi(i)}
                className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                  si === i ? `${v.accent} shadow-sm` : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300"
                }`}>
                {i+1}. {SCREEN_LBL[s]}
              </button>
            ))}
          </div>

          {/* Screen card */}
          <div className="max-w-md mx-auto">
            <ScreenCard vk={av} sk={SCREENS[si]} showMeta={showMeta} />
          </div>

          {/* Prev / Next */}
          <div className="flex justify-center gap-4 mt-6">
            <button onClick={() => setSi(Math.max(0, si-1))} disabled={si === 0}
              className="px-5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-600 text-sm font-medium disabled:opacity-30 hover:border-gray-400 transition-all">
              ← Назад
            </button>
            <button onClick={() => setSi(Math.min(5, si+1))} disabled={si === 5}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium ${v.accent} disabled:opacity-30 shadow-sm transition-all`}>
              Далее →
            </button>
          </div>
        </>}

        {/* COMPARE VIEW */}
        {view === "compare" && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-5">⚖️ Сравнение 3 вариантов CJM</h3>
            <CompareTable />
          </div>
        )}

        {/* SCORE VIEW */}
        {view === "score" && (
          <ScoringCards scores={scores} setScores={setScores} />
        )}

        {/* ── LOCK SECTION ── */}
        <div className="mt-10 p-6 bg-white rounded-2xl shadow-sm border border-gray-100 text-center">
          <p className="text-sm font-semibold text-gray-700 mb-1">Зафиксировать вариант → M3-M6</p>
          <p className="text-xs text-gray-400 mb-4">Winning CJM станет основой для конкурентного анализа, юнит-экономики и 90-дневного playbook</p>
          <div className="flex gap-2 justify-center flex-wrap">
            {Object.entries(VARIANTS).map(([k, var_]) => (
              <button key={k} onClick={() => setLocked(k)}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:shadow-lg border-2 ${
                  av === k
                    ? `${var_.accent} border-transparent shadow-md scale-105`
                    : `bg-white ${var_.txt} border-current hover:scale-105`
                }`}>
                ✅ Выбираю {k}: {var_.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
