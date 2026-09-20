# Mezon English Bot

Multi-tenant Mezon bot cho các trung tâm tiếng Anh. 1 bot instance phục vụ nhiều trung tâm, mỗi trung tâm (Mezon clan) có cấu hình riêng.

## Tech Stack

- **NestJS** + **Nezon** (Mezon bot framework)
- **Prisma** + **PostgreSQL** (Bot Central DB)
- **TypeScript**

## Tính năng

| Command | Mô tả | Message Type |
|---------|-------|-------------|
| User join clan | Gửi Welcome message | DM |
| `*thi` | Gửi link bài thi ngẫu nhiên | Ephemeral |
| `*ketqua` | Xem kết quả gần nhất | Ephemeral |
| `*ketqua <id>` | Xem kết quả bài thi cụ thể | Ephemeral |
| `*lichsu` | Lịch sử 10 lần thi gần nhất | Ephemeral |
| `*admin` | Quản lý cấu hình trung tâm | Ephemeral |

## Multi-tenant

- Mỗi Mezon clan = 1 trung tâm
- Mỗi trung tâm có web app + DB riêng
- Bot có Central DB riêng lưu config
- Dynamic commands: bật/tắt, đổi prefix, alias per tenant

## Setup

```bash
# 1. Clone & install
cd mezon-english-bot
npm install

# 2. Setup environment
cp .env.example .env
# Sửa .env: MEZON_TOKEN, MEZON_BOT_ID, DATABASE_URL

# 3. Setup database
npx prisma generate
npx prisma db push

# 4. Run
npm run start:dev
```

## Đăng ký trung tâm mới

1. Add bot vào Mezon clan
2. Trong clan, gõ:
```
*admin register "Tên Trung Tâm" https://webapp-url.com api-secret bot-secret
```

## Kiến trúc

```
Bot Server ←→ Mezon Platform ←→ Multiple Clans
    │
    ├── Bot Central DB (tenants, commands config)
    │
    ├──→ Web App #1 (Trung tâm A) ←→ DB #1
    ├──→ Web App #2 (Trung tâm B) ←→ DB #2
    └──→ Web App #N (Trung tâm N) ←→ DB #N
```
