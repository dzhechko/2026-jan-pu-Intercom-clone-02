# Инфраструктура КоммуниК

## Обзор

КоммуниК развернут на российской VPS-инфраструктуре HOSTKEY в соответствии с требованиями 152-ФЗ. Все данные хранятся и обрабатываются на территории РФ.

## PostgreSQL 16

### Схемы базы данных

База данных организована по 6 схемам, соответствующим Bounded Contexts:

| Схема | Bounded Context | Основные таблицы |
|-------|-----------------|------------------|
| `conversation` | BC-01 Conversation | dialogs, messages, channels |
| `pql` | BC-02 PQL Intelligence | pql_signals, pql_scores, pql_feedback, rules |
| `revenue` | BC-03 Revenue | attributions, revenue_reports, deals |
| `integration` | BC-04 Integration | mcp_configs, sync_logs |
| `iam` | BC-05 Identity & Access | tenants, operators, api_keys |
| `notifications` | BC-06 Notifications | notification_settings, notification_log |

### Row-Level Security (RLS)

Каждая таблица с полем `tenant_id` защищена политикой RLS:

```sql
-- Пример политики RLS
ALTER TABLE conversation.dialogs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON conversation.dialogs
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

Middleware автоматически устанавливает `SET app.tenant_id` перед каждым запросом. Это гарантирует, что тенант A никогда не увидит данные тенанта B.

**Важно:** Никогда не используйте `WHERE tenant_id = ?` -- RLS обрабатывает изоляцию автоматически.

### Миграции

```bash
# Запуск миграций
docker-compose exec app npm run db:migrate

# Откат
docker-compose exec app npm run db:rollback

# Создание новой миграции
docker-compose exec app npm run db:create-migration -- --name add_pql_feedback_table
```

Миграции выполняются последовательно и идемпотентно. Каждая миграция записывается в таблицу `migrations`.

### Конфигурация PostgreSQL

```yaml
# docker-compose.yml
postgres:
  image: postgres:16-alpine
  environment:
    POSTGRES_USER: kommunik
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    POSTGRES_DB: kommunik
  volumes:
    - pgdata:/var/lib/postgresql/data
    - ./init.sql:/docker-entrypoint-initdb.d/init.sql
  command: >
    postgres
    -c shared_buffers=256MB
    -c effective_cache_size=768MB
    -c work_mem=16MB
    -c maintenance_work_mem=128MB
    -c max_connections=100
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U kommunik"]
    interval: 10s
    timeout: 5s
    retries: 5
```

### Индексы

Ключевые индексы для производительности:

```sql
-- PQL детекция < 2000ms (FF-01)
CREATE INDEX idx_dialogs_tenant_status ON conversation.dialogs(tenant_id, status);
CREATE INDEX idx_messages_dialog_created ON conversation.messages(dialog_id, created_at);
CREATE INDEX idx_pql_scores_dialog ON pql.pql_scores(dialog_id);

-- Revenue отчеты
CREATE INDEX idx_attributions_tenant_period ON revenue.attributions(tenant_id, created_at);
CREATE INDEX idx_deals_status ON revenue.deals(status, closed_at);
```

## Redis 7

### Назначение

Redis используется для нескольких целей:

| Функция | Описание | Конфигурация |
|---------|----------|--------------|
| **Кеш** | CRM-контекст Memory AI, сессии | TTL 5 минут (CRM), 24 часа (сессии) |
| **Presence** | Онлайн-статус операторов | Heartbeat каждые 30 секунд |
| **Rate Limiting** | Ограничение частоты запросов | express-rate-limit + Redis store |
| **Redis Streams** | Асинхронная обработка событий | Consumer Groups для воркеров |
| **Pub/Sub** | Уведомления в реальном времени | Каналы по tenant_id |

### Redis Streams

Основной механизм асинхронной обработки:

```
Поток: kommunik:events
├── MessageReceived   → PQL Detector (consumer group: pql-workers)
├── PQLDetected       → Revenue Attribution + Notification
├── DealStatusChanged → Revenue Report update
└── DialogClosed      → Analytics update
```

Гарантии:
- Lag < 1000 сообщений (FF-08)
- Consumer Groups обеспечивают обработку каждого события ровно одним воркером
- Неподтвержденные сообщения автоматически переназначаются через 60 секунд

### Конфигурация Redis

```yaml
# docker-compose.yml
redis:
  image: redis:7-alpine
  command: >
    redis-server
    --appendonly yes
    --appendfsync everysec
    --maxmemory 512mb
    --maxmemory-policy allkeys-lru
  volumes:
    - redisdata:/data
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
```

### Мониторинг Redis

```bash
# Статус Redis Streams
docker-compose exec redis redis-cli XINFO STREAM kommunik:events

# Информация о consumer groups
docker-compose exec redis redis-cli XINFO GROUPS kommunik:events

# Pending сообщения (не подтвержденные)
docker-compose exec redis redis-cli XPENDING kommunik:events pql-workers

# Использование памяти
docker-compose exec redis redis-cli INFO memory
```

## Nginx

### Роли

- Reverse proxy для приложения
- SSL/TLS терминация
- WebSocket проксирование (Socket.io)
- Rate limiting на уровне HTTP
- Статические файлы (Chat Widget)
- Gzip сжатие

### Конфигурация

```nginx
upstream app {
    server app:3000;
}

# Rate limiting
limit_req_zone $binary_remote_addr zone=api:10m rate=100r/m;
limit_req_zone $binary_remote_addr zone=widget:10m rate=10r/m;

server {
    listen 443 ssl http2;
    server_name yourdomain.ru;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Gzip
    gzip on;
    gzip_types text/plain application/json application/javascript text/css;

    # API с rate limiting
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /socket.io/ {
        proxy_pass http://app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # Chat Widget
    location /widget/ {
        limit_req zone=widget burst=5 nodelay;
        proxy_pass http://app;
    }

    # Статика
    location /_next/static/ {
        proxy_pass http://app;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }
}
```

## Мониторинг

### Health Checks

Каждый сервис имеет health check:

| Сервис | Эндпоинт / Команда | Интервал |
|--------|---------------------|----------|
| App | `GET /api/health` | 30 секунд |
| Worker | Heartbeat в Redis | 30 секунд |
| PostgreSQL | `pg_isready` | 10 секунд |
| Redis | `redis-cli ping` | 10 секунд |
| Nginx | TCP check порт 443 | 10 секунд |

### Логирование

Уровни логирования:

```
ERROR  — ошибки, требующие немедленного внимания
WARN   — потенциальные проблемы (Circuit Breaker open, high latency)
INFO   — ключевые бизнес-события (PQL detected, dialog created)
DEBUG  — детальная информация для отладки (только в development)
```

Логи пишутся в stdout/stderr и собираются Docker:

```bash
# Просмотр логов с фильтром
docker-compose logs -f app | grep "ERROR"

# Логи за последний час
docker-compose logs --since="1h" worker
```

### Grafana MCP (опционально)

Подключение Grafana MCP через Cloud.ru AI Fabric позволяет:
- Визуализировать метрики PQL детекции (latency p95/p99)
- Мониторить Redis Streams lag
- Отслеживать Circuit Breaker статус MCP адаптеров
- Дашборд нагрузки на операторов

## Бэкапы

### PostgreSQL

```bash
# Полный бэкап
docker-compose exec postgres pg_dump -U kommunik kommunik | gzip > backup_$(date +%Y%m%d).sql.gz

# Восстановление
gunzip < backup_20260115.sql.gz | docker-compose exec -T postgres psql -U kommunik kommunik

# Автоматический бэкап (cron)
# Добавить в crontab:
0 3 * * * docker-compose exec -T postgres pg_dump -U kommunik kommunik | gzip > /backups/kommunik_$(date +\%Y\%m\%d).sql.gz
```

Рекомендуемое расписание:
- Полный бэкап: ежедневно в 03:00 MSK
- Хранение: минимум 30 дней
- Тестирование восстановления: ежемесячно

### Redis

Redis настроен с AOF (Append Only File):

```bash
# Ручной снапшот
docker-compose exec redis redis-cli BGSAVE

# Файлы данных в томе redisdata:
# - appendonly.aof — журнал операций
# - dump.rdb — периодический снапшот
```

## Масштабирование

### Горизонтальное масштабирование

Worker отделен от основного приложения и может масштабироваться независимо:

```bash
# Запуск дополнительных воркеров
docker-compose up -d --scale worker=3
```

Redis Consumer Groups автоматически распределяют нагрузку между воркерами.

### Вертикальное масштабирование

| Компонент | Минимум | Рекомендация (до 1000 диалогов/день) |
|-----------|---------|--------------------------------------|
| App | 1 CPU, 1 GB RAM | 2 CPU, 4 GB RAM |
| Worker | 1 CPU, 512 MB RAM | 2 CPU, 2 GB RAM |
| PostgreSQL | 1 CPU, 1 GB RAM | 2 CPU, 4 GB RAM |
| Redis | 1 CPU, 256 MB RAM | 1 CPU, 512 MB RAM |

### Узкие места и решения

| Узкое место | Признак | Решение |
|-------------|---------|---------|
| PQL детекция > 2s | FF-01 алерт | Увеличить воркеры, оптимизировать правила |
| Redis Streams lag > 1000 | FF-08 алерт | Добавить воркеры, проверить consumer groups |
| PostgreSQL slow queries | Логи > 500ms | Добавить индексы, увеличить shared_buffers |
| WebSocket disconnects | Логи reconnect | Проверить Nginx proxy_read_timeout |
