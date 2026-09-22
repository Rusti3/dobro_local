# Первый шаг — MAX

Полная MAX-версия проекта «Первый шаг»: чат-бот MAX + Mini App для человека, который хочет начать помогать, но откладывает первый визит. Внутри сохранены каталог ДОБРО, персональная лента, план визита, приглашение друга, «сад» и напоминания.

Проект отделён от `dobrie_dela_first` и не изменяет исходную папку.

## Быстрый запуск Docker-версии

Нужны только Git и Docker Desktop (или Docker Engine с Compose). Токен MAX и файл `.env`
для локального деморежима не требуются:

```bash
git clone https://github.com/Rusti3/dobro_local.git
cd dobro_local
docker compose up -d --build
```

После запуска откройте `http://localhost:3210`. Первый запуск может занять несколько минут:
Docker соберёт приложение, поднимет PostgreSQL, выполнит миграции и запустит фоновую загрузку
событий. Проверить состояние можно командой `docker compose ps`, а остановить проект —
`docker compose down`. Данные сохраняются в Docker volume и не пропадают после остановки.

Для LLM-разметки скопируйте `.env.example` в `.env` и укажите свой `LLM_API_KEY`. Без ключа
сайт и синхронизация каталога работают, а очередь разметки остаётся на паузе.

## Что изменено для MAX

- MAX Bridge подключается через `https://st.max.ru/js/max-web-app.js`.
- `window.WebApp.initData` передаётся в `X-Max-Init-Data` и проверяется на сервере по HMAC-SHA256 по алгоритму MAX.
- Bot API использует только `https://platform-api2.max.ru` и заголовок `Authorization`.
- Для бота есть Long Polling для разработки и HTTPS Webhook через `POST /subscriptions` для production.
- В проект включён корневой сертификат Минцифры `russiantrustedca.pem`; путь можно переопределить через `MAX_CA_BUNDLE`.
- Диплинки приглашений используют `https://max.ru/<bot_username>?startapp=i_<code>`.

## Локальный запуск

Нужны Node.js 24+ и Docker. Приложение больше не использует SQLite: пользователи, планы,
приглашения, события, вакансии, очередь и результаты LLM-разметки хранятся в PostgreSQL.

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
npm ci
npm run db:migrate
npm run dev
```

Откройте `http://127.0.0.1:3210`. При `DEMO_MODE=true` авторизация работает через
HttpOnly cookie, но данные всё равно сохраняются в PostgreSQL.

Проверки:

```powershell
npm test
npm run build
$env:TEST_DATABASE_URL = "postgresql://dobrie_dela_app:replace-app-password@127.0.0.1:54329/dobrie_dela"
npm test
npm run integration:postgres
```

С токеном MAX для разработки:

```powershell
$env:MAX_BOT_TOKEN = "токен_из_MAX_для_бизнеса"
$env:MAX_BOT_USERNAME = "your_bot"
$env:MAX_MINI_APP_URL = "https://ваш-домен.example"
$env:MAX_POLLING = "true"
npm run bot:setup
npm start
```

Long Polling предназначен для разработки. При одном запущенном процессе бот отвечает на `/start`, `/help`, `/plan`, `/garden`, `/stop`, `/delete` и открывает Mini App кнопкой MAX.

Если Webhook уже был настроен на удалённый адрес, запускайте локальный режим так — он сначала отключит подписку Webhook и только потом включит Long Polling:

```powershell
npm run bot:polling
```

Обычный `npm start` при заданном `MAX_WEBHOOK_URL` не переключает транспорт автоматически: Webhook должен обслуживаться процессом на публичном HTTPS-сервере, а не локальным `127.0.0.1`.

## Production Webhook

Mini App должен быть опубликован по HTTPS и добавлен в настройках чат-бота MAX для партнёров. Для Webhook нужен доверенный TLS-сертификат; с 25 мая 2026 MAX прекращает поддержку HTTP и самоподписных сертификатов.

В `.env` задайте:

```dotenv
DEMO_MODE=false
MAX_BOT_TOKEN=...
MAX_BOT_USERNAME=your_bot
MAX_MINI_APP_URL=https://example.ru
MAX_WEBHOOK_URL=https://example.ru/api/max/webhook
MAX_WEBHOOK_SECRET=длинный-случайный-секрет
MAX_POLLING=false
```

После первого запуска приложения установите подписку:

```powershell
npm run webhook:setup
npm start
```

`POST /api/max/webhook` проверяет `X-Max-Bot-Api-Secret`, сохраняет пользователя и отправляет ответ через `POST /messages`. Long Polling и Webhook нельзя использовать одновременно.

### Vercel

Старый Vercel-handler оставлен только для совместимости с прежним статическим деплоем.
Он не запускает почасовой worker и не является полной production-конфигурацией. Для постоянного
PostgreSQL, синхронизации ДОБРО и LLM-разметки используйте Docker Compose ниже.

## Docker

```powershell
Copy-Item .env.example .env
# Заполните POSTGRES_* и серверные MAX_*/LLM_* переменные в .env
docker compose up --build -d
docker compose ps
Invoke-WebRequest http://127.0.0.1:3210/api/health
```

Именно Docker-сборка по умолчанию разрешает локальный вход без MAX через cookie-сессию
(`DEMO_MODE=true` внутри контейнера). Для production MAX явно задайте в окружении Compose
`DOCKER_DEMO_MODE=false`; обычный `DEMO_MODE` из локального `.env` на Docker-режим не влияет.

Compose поднимает три сервиса:

- `app` — собранный Mini App и HTTP/backend API;
- `worker` — почасовой сбор актуальных вакансий ДОБРО и очередь LLM-разметки;
- `postgres` — PostgreSQL 17 с отдельным несуперпользовательским пользователем приложения.

Данные хранятся в volume `postgres-data`, поэтому перезапуск контейнеров их не удаляет.
Начальная синхронизация Москвы может занять несколько минут; сайт при этом уже доступен на
`http://127.0.0.1:3210`. Статус виден в `/api/health` и логах:

```powershell
docker compose logs -f worker
```

Worker каждые 60 минут сверяет каталог, помечает исчезнувшие и завершившиеся события
неактивными, ставит новые или изменённые вакансии в очередь и сохраняет строгую JSON-разметку
Terra. Обычная классификация идёт с `reasoning=medium`; повторный `high` запускается только для
`hidden`, `human_review` и противоречивых условий. Несколько worker-контейнеров не запустят одну
синхронизацию одновременно благодаря advisory lock, а задания разметки забираются через
`FOR UPDATE SKIP LOCKED`.

Если LLM API запущен на хосте, контейнер обращается к
`DOCKER_LLM_BASE_URL=http://host.docker.internal:8080/v1`. Сертификат Минцифры копируется в
контейнер и подключается к MAX-клиенту автоматически.

Пароль роли PostgreSQL создаётся только при первом создании volume. Если вы меняете
`POSTGRES_APP_PASSWORD` у уже существующей локальной БД, отдельно измените пароль роли либо
создайте новый тестовый volume; не удаляйте production volume.

## Документация MAX

- [MAX Bot API](https://dev.max.ru/docs-api)
- [Отправка сообщений](https://dev.max.ru/docs-api/methods/POST/messages)
- [Подписка Webhook](https://dev.max.ru/docs-api/methods/POST/subscriptions)
- [MAX Bridge](https://dev.max.ru/docs/webapps/bridge)
- [Валидация WebAppData](https://dev.max.ru/docs/webapps/validation)
- [Подключение Mini App](https://dev.max.ru/docs/webapps/introduction)

Токены не хранятся в репозитории и не входят в проект. Перед публичным запуском замените `MAX_WEBHOOK_SECRET`, настройте HTTPS и проверьте ответ `GET /api/health`.
