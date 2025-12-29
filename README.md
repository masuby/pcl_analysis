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
   - Add your Firebase and Supabase configuration

4. Start the development server:
```bash
npm run dev
```

5. Build for production:
```bash
npm run build
```

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

