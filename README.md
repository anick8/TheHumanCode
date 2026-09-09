# LivePolls — QR Voting Platform

A real-time polling application for events and gatherings. Create poll sessions with unique QR codes, attendees scan to vote, and watch results update live.

**🚀 Live URL:** http://localhost:3000

## Features

- ✅ **Google OAuth** - Product owner authentication only
- ✅ **Session Management** - Create, edit, delete poll sessions  
- ✅ **QR Code Generation** - Unique QR codes per session with PNG download
- ✅ **Real-time Voting** - Anonymous voting with localStorage tokens
- ✅ **Live Results** - Charts update as votes come in
- ✅ **Results Modes** - Live vs. After-all-questions display
- ✅ **Mobile First** - Optimized for QR scanning on phones
- ✅ **Export Capabilities** - JSON export for data analysis

## Application Structure

```
TheHumanCode/
├── app/
│   ├── auth/callback/          # Google OAuth callback
│   ├── dashboard/              # Owner dashboard (protected)
│   │   ├── [sessionId]/        # Session management
│   │   └── [sessionId]/results # Session analytics
│   └── vote/[slug]/            # Public voting page
├── components/
│   ├── AuthProvider.jsx        # Authentication context
│   ├── QRCodeDisplay.jsx       # QR code generation
│   ├── SessionForm.jsx         # Session creation/editing
│   ├── QuestionEditor.jsx      # Question management
│   ├── PollQuestion.jsx        # Voting interface
│   └── ResultsChart.jsx        # Live results charts
├── lib/
│   ├── supabase/               # Supabase client/server
│   └── utils.js                # Utility functions
└── poll-dashboard.html         # Artifact dashboard
```

## Quick Start

### 1. Install Dependencies
```bash
cd TheHumanCode
npm install
```

### 2. Run Development Server
```bash
npm run dev
```
App runs at http://localhost:3000

### 3. Set Up Supabase
1. Create a project at https://supabase.com
2. Run the SQL from `database-setup.sql` in the SQL Editor
3. Copy your project URL and anon key to `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_project_url
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_anon_key
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

### 4. Enable Google OAuth (Optional)
In Supabase Dashboard → Authentication → Providers → Google OAuth

## Usage Guide

### Product Owner Flow
1. **Login** → Sign in with Google on the landing page
2. **Create Session** → Click "New Session" in dashboard
3. **Add Questions** → Add questions and options in the session editor
4. **Share QR Code** → Display QR code at your event or download PNG
5. **Monitor Results** → Watch live results in the results dashboard

### Attendee Flow  
1. **Scan QR** → Use phone camera to scan displayed QR code
2. **Vote** → Answer questions anonymously
3. **See Results** → Results appear based on session settings

## Database Schema

The app uses a complete Supabase PostgreSQL schema with:

- **sessions** - Poll sessions with unique slugs
- **questions** - Questions in order per session
- **options** - Answer choices per question
- **votes** - Anonymous votes with duplicate prevention
- **RLS Policies** - Proper row-level security
- **Real-time** - Live vote subscriptions

## Development

### Tech Stack
- **Frontend**: Next.js 14 App Router (JavaScript)
- **Backend**: Supabase (PostgreSQL + Auth + Realtime)
- **Styling**: Tailwind CSS
- **Deployment**: Ready for Vercel

### Available Scripts
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm start           # Start production server
npm run lint        # Run ESLint
```

### Environment Variables
See `.env.local.example` for required variables:
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` - Your Supabase anon key
- `NEXT_PUBLIC_APP_URL` - App URL for QR codes (default: localhost:3000)

## Deployment

### Deploy to Vercel
```bash
# 1. Push to GitHub
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-repo-url>
git push -u origin main

# 2. Import to Vercel
# - Go to vercel.com
# - Import from GitHub
# - Set environment variables
# - Deploy
```

### Production Environment Variables
Set these in Vercel dashboard:
```
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_anon_key  
NEXT_PUBLIC_APP_URL=https://your-domain.vercel.app
```

## Artifact Dashboard

The `poll-dashboard.html` file provides a standalone artifact dashboard that can be published separately. It's designed as a central monitoring hub for session owners to track multiple polls.

**Key Features:**
- Real-time statistics across all sessions
- Session management table
- Voting activity charts
- Theme-aware design (light/dark mode)
- Responsive mobile layout

## Testing

### Manual Testing Scenarios
1. **Landing Page** → Check Google OAuth button works
2. **Dashboard** → Create a new session
3. **QR Code** → Generate and download QR code
4. **Voting Page** → Test voting flow (/vote/{slug})
5. **Results** → Verify live updates work

### Demo Mode
The app works without Supabase using sample data:
- Local voting with localStorage tokens
- Simulated real-time vote updates
- Sample questions and options

## Troubleshooting

### Common Issues

**1. Supabase Connection Error**
```bash
# Check environment variables
echo $NEXT_PUBLIC_SUPABASE_URL
echo $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

# Test Supabase connection
curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/"
```

**2. Google OAuth Not Working**
- Ensure Google provider is enabled in Supabase
- Add `http://localhost:3000/auth/callback` to allowed redirect URLs
- Check Google OAuth client ID in environment

**3. QR Code Not Downloading**
- Modern browsers require same-origin for canvas toDataURL
- Use the built-in download button in QRCodeDisplay component

**4. Real-time Not Working**
- Ensure `votes` table is added to Supabase Realtime
- Check browser console for subscription errors
- Verify network connectivity to Supabase

## API Endpoints

### REST API (via Supabase)
- `GET /rest/v1/sessions` - List active sessions
- `POST /rest/v1/sessions` - Create new session
- `GET /rest/v1/questions?session_id=eq.{id}` - Get session questions
- `POST /rest/v1/votes` - Submit vote (anonymous)

### Application Routes
- `/` - Landing page with Google OAuth
- `/dashboard` - Session management dashboard
- `/dashboard/sessions/{id}` - Session editor with QR code
- `/vote/{slug}` - Public voting page
- `/vote/{slug}/results` - Results page

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit pull request

## License

MIT License - see LICENSE file for details

## Support

- **Issues**: GitHub Issues
- **Documentation**: This README
- **Live Support**: Contact through application

---

**Next Steps:**
1. Set up Supabase with the provided SQL schema
2. Configure Google OAuth for production
3. Deploy to Vercel for public access
4. Test with real users at an event

The application is production-ready and can be deployed immediately!