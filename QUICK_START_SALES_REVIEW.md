# 🚀 Quick Start - Sales Review Report

## For End Users

### Access the Report (3 Steps)
1. **Open Dashboard** → Click "Dashboard" in main menu
2. **Go to Departmental** → Select "Departmental Dashboard" tab
3. **Click Button** → Press "SALES REVIEW REPORT" (2nd button)

```
Navigation Bar:
[SCORE CARD REPORTS] [SALES REVIEW REPORT] ← Click here!
```

### Generate PowerPoint (2 Steps)
1. **Select Month** → Use month picker (top right)
2. **Generate** → Click green "Generate PowerPoint" button

📥 File downloads automatically: `Sales_Review_2026-02.pptx`

---

## For Developers

### File Location
```
src/pages/Dashboard/components/DepartmentalDashboard/components/SalesReviewReport/
```

### Import Component
```javascript
import SalesReviewReport from './components/SalesReviewReport/SalesReviewReport';
```

### Use Component
```javascript
<SalesReviewReport userData={userData} />
```

### Dependencies
```bash
npm install pptxgenjs  # Already installed ✅
```

---

## What's Inside

### 4 Report Sections
1. **Key Metrics** - 8 KPI cards
2. **Performance Overview** - 3 interactive charts
3. **Branch Analysis** - Comparative charts & tables
4. **Trend Analysis** - Insights & recommendations

### 8 PowerPoint Slides
1. Title
2. Executive Summary
3. Disbursements Chart
4. Branch Comparison
5. Portfolio Quality
6. Business Mix
7. Conclusions
8. Thank You

---

## Data Sources

✅ Management Dashboard (`useManagementData` hook)
✅ Countrywide data
✅ CS branches (CS, CS Asset Finance)
✅ LBF branches (LBF, IPF, MIF, MIF Customs, Lbf Yard Finance, LBF QUICKCASH)
✅ SME data
✅ Zanzibar data

---

## Quick Troubleshooting

### Report Not Loading?
→ Ensure management reports are uploaded

### Charts Empty?
→ Check data availability for selected period

### PPTX Won't Download?
→ Check browser popup blocker settings

### Values Look Wrong?
→ Verify source data in Management Dashboard

---

## Key Metrics Tracked

| Metric | Description |
|--------|-------------|
| 💰 Disbursements | Monthly loan disbursements |
| 👥 Active Clients | Number of active borrowers |
| 📊 Portfolio | Total outstanding loans |
| 📝 Active Loans | Count of active loans |
| ⚠️ PAR > 30 | Portfolio at risk |
| 🆕 New Business | Loans to new customers |
| 🔄 Repeat Business | Loans to returning customers |
| 📈 Portfolio Quality | PAR ratio percentage |

---

## Color Codes

🟢 Green = Good/Positive trend
🔴 Red = Warning/Negative trend
🟠 Orange = Caution/Moderate risk
🔵 Blue = Information/Neutral

---

## Need Help?

📖 **Full Documentation:**
- `USAGE_GUIDE.md` - Complete user manual
- `README.md` - Technical documentation
- `SALES_REVIEW_IMPLEMENTATION.md` - Build details

🐛 **Issues?** Check browser console for errors

---

## Version Info

**Version:** 1.0.0
**Status:** ✅ Live & Ready
**Updated:** February 2, 2026

---

**That's it! You're ready to use the Sales Review Report!** 🎉
