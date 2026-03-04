# BDD Test Scenarios: КоммуниК
**Version:** 1.0 | **Date:** 2026-03-04
**Format:** Gherkin (Feature/Scenario/Given-When-Then)

---

## Feature: PQL Detection (Core — BC-02)

```gherkin
Feature: PQL Detection — автоматическое обнаружение горячих лидов
  As an оператор поддержки
  I want видеть 🔥 метку на диалоге когда клиент готов к покупке
  So that я могу передать лид в продажи без ручного анализа

  Background:
    Given существует активный тенант "acme-saas" с планом GROWTH
    And детектор настроен с порогом 0.65
    And оператор "ivan@acme.ru" авторизован в Workspace

  # ─── Happy Path ───────────────────────────────────────────────

  Scenario: Обнаружение PQL по Enterprise сигналу
    Given открыт диалог с клиентом "client@example.com"
    And клиент активен в системе 90 дней на плане FREE
    When клиент отправляет сообщение "А у вас есть Enterprise-тариф для команды 50 человек?"
    Then PQL флаг должен появиться в течение 2 секунд
    And тир должен быть HOT (score >= 0.80)
    And сработавшие сигналы должны содержать ["ENTERPRISE", "SCALE"]
    And в сайдбаре оператора отображается "🔥 Горячий лид"
    And отображается контекст из amoCRM: план, дней активности, открытые сделки
    And событие PQLDetected опубликовано в Redis Stream

  Scenario: PQL по нескольким слабым сигналам (суммирование весов)
    Given открыт диалог с клиентом "client2@example.com"
    When клиент отправляет "Хотел бы посмотреть демо, нас интересует интеграция с нашей системой и SLA"
    Then PQL флаг должен появиться в течение 2 секунд
    And тир должен быть WARM (score >= 0.65)
    And сработавшие сигналы должны содержать ["DEMO", "TECHNICAL", "RELIABILITY"]

  Scenario: PQL Pulse уведомление оператору
    Given оператор включил уведомления типа PUSH
    And открыт диалог назначенный на оператора "ivan@acme.ru"
    When PQL обнаружен с тиром HOT
    Then оператор получает push-уведомление в течение 30 секунд
    And уведомление содержит: имя клиента, топ-1 сигнал, ссылку на диалог

  # ─── Error Handling ───────────────────────────────────────────

  Scenario: amoCRM MCP недоступен — детекция продолжается без контекста
    Given amoCRM MCP Circuit Breaker в состоянии OPEN
    When клиент отправляет "Хотим перейти с текущего решения, интересует договор"
    Then PQL детекция выполняется без CRM-контекста
    And enrichmentScore равен 0.0
    And context boost не применяется
    And PQL флаг появляется если базовый score >= threshold
    And в логах записан warn "amoCRM MCP unavailable, proceeding without context"

  Scenario: Сообщение от оператора НЕ триггерит PQL
    Given открыт диалог с активным PQL
    When оператор "ivan@acme.ru" отправляет "Готов рассказать про Enterprise тарифы, давайте договор оформим"
    Then новый PQL флаг НЕ создаётся
    And в логах записан debug "skip: not_client_message"

  Scenario: Score ниже порога — флаг не ставится
    Given детектор с порогом 0.65
    When клиент отправляет "Спасибо, всё понятно"
    Then PQL флаг НЕ создаётся
    And событие PQLDetected НЕ публикуется
    And диалог остаётся без pql_tier

  # ─── Edge Cases ───────────────────────────────────────────────

  Scenario: Повторный PQL в том же диалоге — не дублируется
    Given диалог уже имеет PQL тир HOT
    When клиент отправляет ещё одно Enterprise сообщение
    Then новая детекция записывается в pql.detections
    And pql_score в dialogs обновляется если новый score выше
    And оператору НЕ отправляется повторный PQL Pulse в течение 30 минут

  Scenario: Кастомные правила тенанта перекрывают дефолтные
    Given тенант настроил кастомное правило R-CUSTOM с pattern "попробовать платную версию" weight=0.7
    When клиент отправляет "Хочу попробовать платную версию"
    Then срабатывает правило R-CUSTOM
    And score >= 0.65 (выше порога)
    And PQL флаг создаётся
```

---

## Feature: Memory AI — CRM Context в Workspace (BC-02 + BC-04)

```gherkin
Feature: Memory AI — автозагрузка контекста клиента из amoCRM
  As an оператор поддержки
  I want видеть историю клиента до первого ответа
  So that я не задаю повторных вопросов и отвечаю по контексту

  Background:
    Given тенант настроил интеграцию с amoCRM
    And amoCRM MCP доступен и Circuit Breaker CLOSED

  Scenario: Полный контекст загружается до первого ответа оператора
    Given клиент "client@example.com" существует в amoCRM
    And у клиента план "Growth", зарегистрирован 120 дней назад
    And в amoCRM есть 1 открытая сделка "Upgrade to Revenue"
    When клиент открывает новый диалог
    Then в сайдбаре оператора отображается в течение 1 секунды:
      | Поле             | Значение                  |
      | Текущий план     | Growth                    |
      | Дней активности  | 120                       |
      | Открытые сделки  | 1 (Upgrade to Revenue)    |
      | Последний контакт| дата последней активности |
    And enrichmentScore >= 0.8

  Scenario: Клиент не найден в amoCRM — workspace работает без контекста
    Given клиент "new@unknown.com" НЕ существует в amoCRM
    When клиент открывает новый диалог
    Then сайдбар показывает "Новый клиент — данных в CRM нет"
    And enrichmentScore равен 0.0
    And диалог продолжается в штатном режиме

  Scenario: Контекст кешируется — повторные запросы не идут в MCP
    Given контекст клиента "client@example.com" уже загружен (cached)
    When тот же клиент пишет второе сообщение в течение 10 минут
    Then amoCRM MCP НЕ вызывается повторно
    And контекст возвращается из кеша за < 10ms
```

---

## Feature: Revenue Intelligence Report (BC-03)

```gherkin
Feature: Revenue Intelligence Report — ежемесячный ROI отчёт
  As a SaaS CEO / Head of Support
  I want получать ежемесячный PDF-отчёт
  So that я вижу сколько выручки принесла поддержка

  Background:
    Given существует активный тенант с планом REVENUE
    And интеграция с amoCRM настроена и активна

  Scenario: Успешная генерация отчёта 1-го числа месяца
    Given в феврале 2026 было 23 PQL-детекции
    And amoCRM подтверждает 7 закрытых сделок из PQL-диалогов
    And общая сумма сделок 2,100,000 ₽
    When запускается cron job 1 марта 2026 в 09:00
    Then отчёт за февраль создаётся со статусом GENERATED
    And summary содержит:
      | Поле               | Значение |
      | PQL обнаружено     | 23       |
      | Сделок закрыто     | 7        |
      | Конверсия PQL→deal | 30.4%    |
      | Выручка            | ₽2,100,000 |
    And PDF сгенерирован через Puppeteer
    And CEO и Head of Support получают email с PDF в течение 5 минут

  Scenario: amoCRM MCP недоступен при генерации — отчёт откладывается
    Given amoCRM MCP Circuit Breaker OPEN во время cron запуска
    When запускается генерация отчёта
    Then отчёт остаётся в статусе DRAFT
    And событие ReportFailed публикуется в notifications queue
    And повторная попытка запланирована через 1 час
    And в логах записан error "amoCRM MCP unavailable during report generation"

  Scenario: Тенант без PQL за месяц — отчёт не генерируется
    Given за март 2026 у тенанта 0 PQL-детекций
    When запускается cron job 1 апреля 2026
    Then отчёт НЕ создаётся
    And в логах записан info "No PQL detections for period, skipping report"
    And тенант НЕ получает пустой email

  Scenario: Атрибуция только для верифицированных PQL
    Given детекция D-001 имеет feedback = INCORRECT (оператор отметил неверно)
    And детекция D-002 имеет feedback = NULL (нет обратной связи)
    And детекция D-003 имеет feedback = CORRECT
    When генерируется отчёт
    Then D-001 исключается из атрибуций
    And D-002 включается (neutral = включаем по умолчанию)
    And D-003 включается с confidence = 1.0
```

---

## Feature: Operator Workspace — Unified Inbox (BC-01)

```gherkin
Feature: Operator Workspace — единая очередь всех каналов
  As an оператор поддержки
  I want видеть сообщения из всех каналов в одном месте
  So that я не переключаюсь между вкладками

  Scenario: Новое сообщение из Telegram появляется в очереди
    Given Telegram Bot API настроен для тенанта
    When клиент пишет в Telegram "Привет, вопрос по тарифам"
    Then диалог появляется в Operator Workspace в течение 3 секунд
    And канал отображается как "💬 Telegram"
    And диалог помещается в очередь со статусом OPEN

  Scenario: PQL-диалоги сортируются выше обычных
    Given в очереди 5 обычных диалогов и 2 PQL-диалога (HOT)
    When оператор открывает Workspace
    Then PQL-диалоги отображаются первыми (сортировка: HOT > WARM > остальные)
    And HOT диалоги помечены 🔥

  Scenario: Назначение диалога на оператора
    Given диалог имеет статус OPEN без назначения
    When оператор "ivan@acme.ru" нажимает "Взять в работу"
    Then диалог получает статус ASSIGNED
    And assignedOperatorId = ivan's id
    And другие операторы видят диалог как занятый
    And событие DialogAssigned публикуется

  Scenario: WebSocket соединение восстанавливается после разрыва
    Given оператор подключён через Socket.io
    When сетевое соединение прерывается на 10 секунд
    Then Socket.io автоматически переподключается
    And все пропущенные сообщения доставляются после reconnect
    And оператор видит непрерывную историю диалогов
```

---

## Feature: Multi-tenancy & Security (BC-05)

```gherkin
Feature: Мультитенантность — изоляция данных между клиентами
  As a platform operator
  I want гарантировать что данные тенантов изолированы
  So that ни один тенант не видит данные другого

  Scenario: Row-Level Security предотвращает доступ к чужим данным
    Given тенант A имеет 10 диалогов
    And тенант B имеет 5 диалогов
    When API запрос выполняется с JWT тенанта A
    Then в ответе только 10 диалогов тенанта A
    And диалоги тенанта B недоступны (PostgreSQL RLS)
    And попытка запросить dialog_id тенанта B возвращает 404

  Scenario: Истёкший Trial — доступ заблокирован
    Given тенант C на плане TRIAL
    And trial_ends_at = вчера
    When оператор тенанта C пытается открыть Workspace
    Then возвращается HTTP 402 Payment Required
    And отображается страница "Ваш пробный период завершён — выберите план"

  Scenario: Инвайт оператора в тенант
    Given admin "admin@acme.ru" авторизован
    When admin приглашает "new-operator@acme.ru" с ролью OPERATOR
    Then создаётся OperatorRef в Tenant aggregate
    And отправляется email с invite link (TTL 48ч)
    And событие OperatorInvited публикуется
```

---

## Feature: PQL Feedback & ML Flywheel (BC-02)

```gherkin
Feature: PQL Feedback — обучение модели на реальных данных
  As an оператор поддержки
  I want отмечать корректность PQL-флагов
  So that система улучшает точность со временем

  Scenario: Оператор подтверждает PQL как корректный
    Given PQL детекция D-001 с тиром HOT
    When оператор нажимает 👍 "Верно — это лид"
    Then detection.feedback = CORRECT сохраняется
    And создаётся MLTrainingSample с label=true
    And detector.stats.correct += 1
    And событие PQLFeedbackRecorded публикуется

  Scenario: Оператор отмечает PQL как неверный
    Given PQL детекция D-002 (клиент просто спрашивал про документацию)
    When оператор нажимает 👎 "Не лид"
    Then detection.feedback = INCORRECT сохраняется
    And создаётся MLTrainingSample с label=false
    And D-002 исключается из следующего Revenue Report

  Scenario: Триггер ретрейнинга при накоплении данных
    Given накоплено 1000 MLTrainingSample для тенанта
    When публикуется событие PQLFeedbackRecorded с totalSamples=1000
    Then ML Pipeline Worker получает событие
    And ставится задача на fine-tuning модели
    And статус MLModel меняется на TRAINING
```
