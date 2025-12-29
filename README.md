# PCL Analysis Dashboard

A comprehensive analytics dashboard for PCL (Platinum Credit Limited) that provides insights into various business metrics including CS, LBF, SME, and Countrywise data analysis.

## Features

- **Management Dashboard**: Comprehensive analytics with interactive charts and data visualization
- **Report Management**: Upload, view, and manage Excel reports
- **Multi-Section Analysis**: 
  - Countrywise Analysis
  - CS (CS & Cs Asset Finance) Analysis
  - LBF (LBF, IPF, MIF, MIF Customs, Lbf Yard Finance, LBF QUICKCASH) Analysis
  - SME Analysis
  - CSZANZIBAR Analysis
- **Interactive Charts**: Bar, Line, Area, Pie, and Scatter charts with customizable date ranges
- **Data Filtering**: Filter data by date range, view daily or monthly aggregations
- **Branch-Level Analysis**: View individual branch data or aggregated totals
- **User Management**: Admin panel for user administration
- **Authentication**: Secure login system with Firebase

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool
- **Firebase** - Authentication and Firestore database
- **Supabase** - File storage
- **Recharts** - Chart visualization
- **XLSX** - Excel file parsing

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/masuby/pcl_analysis.git
cd pcl_analysis
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
   - Create a `.env` file in the root directory
   - Add the following environment variables (see Environment Variables section below)

4. Start the development server:
```bash
npm run dev
```

5. Build for production:
```bash
npm run build
```

## Environment Variables

The following environment variables are required for the application to work:

### Firebase Configuration
- `VITE_FIREBASE_API_KEY` - Your Firebase API key
- `VITE_FIREBASE_AUTH_DOMAIN` - Your Firebase auth domain (e.g., `your-project.firebaseapp.com`)
- `VITE_FIREBASE_PROJECT_ID` - Your Firebase project ID
- `VITE_FIREBASE_STORAGE_BUCKET` - Your Firebase storage bucket (e.g., `your-project.appspot.com`)
- `VITE_FIREBASE_MESSAGING_SENDER_ID` - Your Firebase messaging sender ID
- `VITE_FIREBASE_APP_ID` - Your Firebase app ID
- `VITE_FIREBASE_MEASUREMENT_ID` - Your Firebase measurement ID (for Analytics)

### Supabase Configuration
- `VITE_SUPABASE_URL` - Your Supabase project URL (e.g., `https://your-project.supabase.co`)
- `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` - Your Supabase anon/public key

**Important**: Never commit your `.env` or `.env.local` files to git. They are already in `.gitignore`.

## Deployment to Vercel

### Setting Up Environment Variables in Vercel

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add each of the environment variables listed above with their actual values
4. Make sure to add them for **Production**, **Preview**, and **Development** environments
5. After adding all variables, **redeploy** your application

### Steps to Deploy

1. Push your code to GitHub (already done)
2. Import your GitHub repository in Vercel
3. Configure environment variables in Vercel dashboard (see above)
4. Vercel will automatically detect Vite and configure the build settings
5. Deploy!

**Note**: If you see a "Firebase: Error (auth/invalid-api-key)" error, it means the environment variables are not set correctly in Vercel. Make sure all variables are added and the deployment is triggered after adding them.

## Project Structure

```
pcl_analysis/
├── src/
│   ├── components/       # Reusable components
│   ├── pages/            # Page components
│   ├── services/         # API and service integrations
│   ├── contexts/         # React contexts
│   └── utils/            # Utility functions
├── public/               # Static assets
└── package.json          # Dependencies
```

## License

Private - All rights reserved

