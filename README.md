# Attention - Private Relationship App

A mobile-first, emotionally engaging web app for private connection between two people.

## Features
- **Beep**: Send a quick ping to your partner with a predefined message.
- **Cooldown**: Only one beep every 30 minutes to keep it meaningful.
- **Real-time**: Get notified instantly when your partner beeps you.
- **Activity Feed**: View your history of connection.
- **PWA Style**: Designed for mobile browsers.

## Setup

### 1. Supabase Configuration
- Create a Supabase project.
- Run the SQL in `supabase/schema.sql` in the Supabase SQL Editor.
- Enable Email Auth and disable "Confirm email" if you want instant signup (or leave it on for security).

### 2. Environment Variables
Create a `.env.local` file with:
```env
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Allowed Users
The app is restricted to two predefined emails. 
Edit `app/signin/page.tsx` and `app/signup/page.tsx` to set your specific emails:
```typescript
const ALLOWED_EMAILS = ['me@example.com', 'partner@example.com'];
```

### 4. Running the app
```bash
npm install
npm run dev
```

## Tech Stack
- Next.js (React)
- Supabase (Auth, Postgres, Realtime)
- Tailwind CSS
- Lucide React Icons
