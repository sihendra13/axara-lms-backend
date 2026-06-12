# Axara LMS Backend

REST API backend untuk Axara LMS (Learning Management System) platform.

## Tech Stack

- **Node.js** v24+
- **Express.js** - REST API framework
- **Supabase** - PostgreSQL database + auth
- **JWT** - Authentication
- **bcrypt** - Password hashing

## Installation

```bash
npm install
```

## Environment Variables

Edit `.env` file dengan credentials Supabase Anda:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_key
JWT_SECRET=your_jwt_secret
PORT=3000
NODE_ENV=development
```

## Running the Server

**Development mode:**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

Server akan run di `http://localhost:3000`

## API Endpoints

Semua endpoint mendapat prefix `/api/v1`

### Health Check
```
GET /health
Response: { status: 'ok', message: '...' }
```

### Authentication (todo)
```
POST /auth/register
POST /auth/login
POST /auth/refresh
```

### Users (todo)
```
GET /users
POST /users/employees
PATCH /users/:id
DELETE /users/:id
```

### Videos (todo)
```
GET /videos
POST /videos
PATCH /videos/:id
DELETE /videos/:id
```

### Quizzes (todo)
```
GET /videos/:videoId/quizzes
POST /videos/:videoId/quizzes
POST /videos/:videoId/submit-quiz
```

## Project Structure

```
src/
├── server.js           # Entry point
├── config/
│   └── database.js     # Supabase client
├── middleware/
│   ├── auth.js         # JWT authentication
│   └── tenant.js       # Tenant isolation
├── routes/             # API endpoints
├── controllers/        # Business logic
└── services/          # Database operations
```

## Database Schema

Database sudah di-setup di Supabase. Lihat `DATABASE_SCHEMA.sql` di root project.

## Security

- ✅ Multi-tenant architecture (Row Level Security)
- ✅ JWT authentication
- ✅ Password hashing (bcrypt)
- ✅ CORS enabled
- ✅ Environment variables for secrets

## Next Steps

1. ✅ Server setup done
2. ⏳ Implement auth endpoints
3. ⏳ Implement user management
4. ⏳ Implement video endpoints
5. ⏳ Implement quiz endpoints
6. ⏳ Deploy to Render/Railway

## Support

For issues or questions, check `/IMPLEMENTATION_ROADMAP.md`
