# Развертывание КоммуниК

## Обзор

КоммуниК разворачивается через Docker Compose на VPS HOSTKEY (российская инфраструктура, соответствие 152-ФЗ). Платформа состоит из 5 сервисов: приложение, воркер, PostgreSQL, Redis и Nginx.

## Требования

- Docker 24.x+
- Docker Compose 2.20+
- VPS с 4+ CPU, 8+ GB RAM, 50+ GB SSD
- Доменное имя с настроенным DNS
- SSL-сертификат (Let's Encrypt или коммерческий)

## Переменные окружения

Создайте файл `.env` в корне проекта:

```bash
# === Приложение ===
NODE_ENV=production
PORT=3000
WORKER_PORT=3001

# === База данных ===
DATABASE_URL=postgresql://kommunik:your_secure_password@postgres:5432/kommunik
POSTGRES_USER=kommunik
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=kommunik

# === Redis ===
REDIS_URL=redis://redis:6379

# === JWT авторизация ===
JWT_SECRET=your_jwt_secret_min_32_chars
JWT_EXPIRES_IN=24h

# === Шифрование API ключей (AES-256-GCM) ===
ENCRYPTION_KEY=your_256bit_encryption_key

# === Telegram Bot ===
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_WEBHOOK_SECRET=your_webhook_hmac_secret

# === amoCRM MCP ===
AMOCRM_MCP_URL=https://mcp.cloud.ru/amocrm
AMOCRM_MCP_TOKEN=your_mcp_token

# === Email (Resend) ===
RESEND_API_KEY=your_resend_api_key
EMAIL_FROM=noreply@yourdomain.ru

# === Мониторинг ===
LOG_LEVEL=info
```

**Важно:** Никогда не коммитьте `.env` в репозиторий. Файл `.env` добавлен в `.gitignore`.

## Docker Compose

### Конфигурация сервисов

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  worker:
    build: .
    command: node dist/worker.js
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  nginx:
    image: nginx:1.25-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/ssl:/etc/nginx/ssl
    depends_on:
      - app
```

### Порядок запуска

```bash
# 1. Клонировать репозиторий
git clone https://github.com/your-org/kommunik.git
cd kommunik

# 2. Создать и заполнить .env
cp .env.example .env
nano .env

# 3. Собрать и запустить все сервисы
docker-compose up -d --build

# 4. Проверить статус
docker-compose ps

# 5. Запустить миграции БД
docker-compose exec app npm run db:migrate

# 6. Проверить здоровье приложения
curl http://localhost:3000/api/health
```

## Health Check

Эндпоинт `/api/health` возвращает статус всех компонентов:

```bash
curl http://localhost:3000/api/health
```

Ответ:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 3600,
  "services": {
    "database": "connected",
    "redis": "connected",
    "worker": "running"
  }
}
```

Используйте этот эндпоинт для мониторинга и балансировщиков нагрузки.

## Миграции базы данных

```bash
# Запуск всех миграций
docker-compose exec app npm run db:migrate

# Откат последней миграции
docker-compose exec app npm run db:rollback

# Статус миграций
docker-compose exec app npm run db:status
```

Миграции создают 6 схем (по одной на каждый Bounded Context) и настраивают Row-Level Security.

## SSL/TLS через Nginx

### Конфигурация Nginx

```nginx
server {
    listen 80;
    server_name yourdomain.ru;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.ru;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Приложение
    location / {
        proxy_pass http://app:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket
    location /socket.io/ {
        proxy_pass http://app:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Установка Let's Encrypt

```bash
# Установить certbot
apt install certbot

# Получить сертификат
certbot certonly --standalone -d yourdomain.ru

# Скопировать в каталог nginx
cp /etc/letsencrypt/live/yourdomain.ru/fullchain.pem nginx/ssl/
cp /etc/letsencrypt/live/yourdomain.ru/privkey.pem nginx/ssl/

# Перезапустить nginx
docker-compose restart nginx
```

## Мониторинг и логи

### Просмотр логов

```bash
# Все сервисы
docker-compose logs -f

# Конкретный сервис
docker-compose logs -f app
docker-compose logs -f worker
docker-compose logs -f postgres

# Последние 100 строк
docker-compose logs --tail=100 app
```

### Мониторинг ресурсов

```bash
# Использование ресурсов контейнерами
docker stats

# Размер томов
docker system df -v
```

### Grafana MCP (опционально)

Для расширенного мониторинга подключите Grafana MCP через Cloud.ru AI Fabric. Это позволит визуализировать метрики PQL детекции, время ответа и нагрузку на Redis Streams.

## Обновление

```bash
# 1. Получить обновления
git pull origin main

# 2. Пересобрать и перезапустить
docker-compose up -d --build

# 3. Запустить новые миграции (если есть)
docker-compose exec app npm run db:migrate

# 4. Проверить здоровье
curl http://localhost:3000/api/health
```

## Устранение неполадок

| Проблема | Решение |
|----------|---------|
| PostgreSQL не запускается | Проверьте свободное место на диске и права на том `pgdata` |
| Redis connection refused | Убедитесь, что `redis` сервис здоров: `docker-compose ps` |
| WebSocket не подключается | Проверьте конфигурацию Nginx для проксирования WebSocket |
| Миграции зависают | Проверьте `DATABASE_URL` и доступность PostgreSQL |
| Worker не обрабатывает события | Проверьте логи: `docker-compose logs worker` |
