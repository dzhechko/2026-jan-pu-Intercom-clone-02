# Руководство администратора КоммуниК

## Обзор

Администратор управляет тенантом (компанией), операторами, интеграциями и настройками PQL детекции. Все операции доступны через REST API и административную панель.

## Создание тенанта

### Регистрация через API

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Моя Компания",
    "email": "admin@company.ru",
    "password": "SecurePassword123!",
    "plan": "professional"
  }'
```

Ответ:

```json
{
  "tenant": {
    "id": "uuid-tenant-id",
    "companyName": "Моя Компания",
    "plan": "professional",
    "createdAt": "2026-01-15T10:00:00Z"
  },
  "operator": {
    "id": "uuid-operator-id",
    "email": "admin@company.ru",
    "role": "ADMIN"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

При регистрации автоматически создаются:
- Тенант с уникальным ID
- Оператор с ролью ADMIN
- Настройки RLS (Row-Level Security) для изоляции данных
- 15 стандартных PQL правил

## Управление операторами

### Роли

| Роль | Права |
|------|-------|
| **ADMIN** | Полный доступ: управление операторами, настройки, интеграции, отчеты |
| **OPERATOR** | Обработка диалогов, просмотр PQL, обратная связь по PQL |

### Создание оператора

```bash
curl -X POST http://localhost:3000/api/operators \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "operator@company.ru",
    "name": "Иван Петров",
    "password": "OperatorPass123!",
    "role": "OPERATOR"
  }'
```

### Деактивация оператора

```bash
curl -X PATCH http://localhost:3000/api/operators/${OPERATOR_ID}/deactivate \
  -H "Authorization: Bearer ${TOKEN}"
```

Деактивированный оператор не может войти в систему, но его история диалогов сохраняется для отчетности.

### Список операторов

```bash
curl http://localhost:3000/api/operators \
  -H "Authorization: Bearer ${TOKEN}"
```

## Настройка PQL правил

### Стандартные сигналы

При создании тенанта устанавливаются 15 стандартных PQL сигналов:

| N | Сигнал | Вес | Пример фразы |
|---|--------|-----|---------------|
| 1 | Запрос цены | 0.25 | "сколько стоит", "какая цена" |
| 2 | Сравнение тарифов | 0.20 | "чем отличается Pro от Basic" |
| 3 | Запрос демо | 0.30 | "можно посмотреть демо" |
| 4 | Запрос триала | 0.25 | "есть пробный период" |
| 5 | Вопрос об оплате | 0.20 | "как оплатить", "принимаете карты" |
| 6 | Запрос интеграции | 0.15 | "интегрируется с 1С" |
| 7 | Масштабирование | 0.20 | "сколько пользователей можно" |
| 8 | Запрос SLA | 0.15 | "какой SLA", "время отклика" |
| 9 | Запрос API | 0.15 | "есть REST API", "документация API" |
| 10 | Миграция | 0.20 | "как перенести данные" |
| 11 | Корпоративный запрос | 0.25 | "для команды из 50 человек" |
| 12 | Запрос скидки | 0.20 | "есть скидки", "годовая подписка" |
| 13 | Срочная потребность | 0.15 | "нужно срочно", "горит проект" |
| 14 | Конкурент | 0.20 | "сейчас используем Bitrix" |
| 15 | Бюджет | 0.25 | "бюджет до 100 тысяч" |

### Управление правилами

```bash
# Получить все правила
curl http://localhost:3000/api/pql/rules \
  -H "Authorization: Bearer ${TOKEN}"

# Обновить вес правила
curl -X PATCH http://localhost:3000/api/pql/rules/${RULE_ID} \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "weight": 0.30,
    "isActive": true
  }'

# Создать пользовательское правило
curl -X POST http://localhost:3000/api/pql/rules \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Запрос onpremise",
    "pattern": "on[- ]?prem|локальная установка|свой сервер",
    "weight": 0.20,
    "category": "ENTERPRISE"
  }'
```

### PQL Score пороги

| Тир | Диапазон | Действие |
|-----|----------|----------|
| **HOT** | >= 0.80 | Немедленное уведомление, приоритет в очереди |
| **WARM** | >= 0.65 | Уведомление, подсветка в списке |
| **COLD** | < 0.65 | Стандартная обработка |

## Подключение amoCRM

amoCRM подключается через MCP адаптер Cloud.ru AI Fabric.

### Настройка

```bash
curl -X POST http://localhost:3000/api/integrations/amocrm \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "mycompany.amocrm.ru",
    "accessToken": "your_amocrm_access_token",
    "refreshToken": "your_amocrm_refresh_token",
    "pipelineId": 12345,
    "responsibleUserId": 67890
  }'
```

### Возможности интеграции

- **Memory AI:** автоматическая загрузка контекста клиента из CRM перед ответом оператора
- **Создание сделок:** автоматическое создание сделки при обнаружении HOT PQL
- **Revenue Attribution:** связка PQL-флага с закрытой сделкой для расчета атрибуции
- **Авто-обновление:** синхронизация статусов сделок каждые 15 минут

### Проверка подключения

```bash
curl http://localhost:3000/api/integrations/amocrm/status \
  -H "Authorization: Bearer ${TOKEN}"
```

## Подключение Telegram бота

### Создание бота

1. Создайте бота через @BotFather в Telegram
2. Получите токен бота
3. Настройте webhook

### Настройка в КоммуниК

```bash
curl -X POST http://localhost:3000/api/integrations/telegram \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    "webhookSecret": "your_hmac_secret"
  }'
```

Система автоматически зарегистрирует webhook в Telegram API. Все входящие сообщения будут создавать диалоги в рабочем пространстве оператора.

### Верификация webhook

Все входящие запросы проверяются через HMAC-SHA256 подпись. Неверифицированные запросы отклоняются с HTTP 401.

## Подключение VK Max

VK Max подключается через Мессенджер Max MCP (Cloud.ru AI Fabric).

```bash
curl -X POST http://localhost:3000/api/integrations/vk-max \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "communityId": "your_community_id",
    "accessToken": "your_vk_max_token"
  }'
```

## Управление уведомлениями PQL Pulse

PQL Pulse -- система уведомлений о обнаруженных PQL.

### Настройка каналов уведомлений

```bash
curl -X PUT http://localhost:3000/api/notifications/settings \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "channels": {
      "websocket": { "enabled": true },
      "email": {
        "enabled": true,
        "recipients": ["sales@company.ru"],
        "minTier": "WARM"
      },
      "telegram": {
        "enabled": true,
        "chatId": "-100123456789",
        "minTier": "HOT"
      }
    },
    "quietHours": {
      "enabled": true,
      "start": "22:00",
      "end": "08:00",
      "timezone": "Europe/Moscow"
    }
  }'
```

### Параметры уведомлений

| Параметр | Описание |
|----------|----------|
| `minTier` | Минимальный тир для отправки: HOT, WARM или COLD |
| `quietHours` | Тихие часы -- уведомления накапливаются и отправляются утром |
| `recipients` | Список email-адресов для оповещений |
| `chatId` | ID Telegram чата/группы для уведомлений |

## Отчетность

### Revenue Intelligence Report

```bash
# Генерация отчета за период
curl -X POST http://localhost:3000/api/revenue/report \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2026-01-01",
    "endDate": "2026-01-31",
    "format": "json"
  }'
```

Отчет показывает:
- Количество обнаруженных PQL по тирам
- Конверсия PQL в сделки
- Атрибутированная выручка через поддержку
- Рейтинг операторов по PQL конверсии
- Тренды по каналам (виджет, Telegram, VK Max)

### Аналитика

```bash
# Дашборд аналитики
curl http://localhost:3000/api/analytics/dashboard \
  -H "Authorization: Bearer ${TOKEN}"
```
