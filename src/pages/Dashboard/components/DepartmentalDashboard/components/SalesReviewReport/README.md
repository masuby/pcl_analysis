# Sales Review Report Component

## Overview
The Sales Review Report is a comprehensive PowerPoint presentation generator that analyzes sales performance data from the Management Dashboard. It provides detailed insights into disbursements, portfolio quality, branch performance, and business trends.

## Features

### 1. **Interactive Dashboard View**
- Real-time data visualization with charts and graphs
- Key performance metrics display
- Branch-wise performance comparison
- Trend analysis with insights

### 2. **PowerPoint Generation**
The system generates a professional PPTX presentation with the following slides:
1. **Title Slide** - Report title and date
2. **Executive Summary** - Key performance indicators
3. **Disbursements Analysis** - 12-month trend chart
4. **Branch Performance** - Comparative analysis across branches
5. **Portfolio Quality** - PAR ratio and portfolio health
6. **Business Mix** - New vs Repeat business analysis
7. **Conclusions & Recommendations** - AI-generated insights
8. **Thank You Slide** - Contact information

### 3. **Data Sources**
The report pulls data from:
- Countrywise aggregated data
- CS branch data (CS, Cs Asset Finance)
- LBF branch data (LBF, IPF, MIF, MIF Customs, Lbf Yard Finance, LBF QUICKCASH)
- SME data
- Zanzibar branch data

## Component Structure

```
SalesReviewReport/
├── SalesReviewReport.jsx          # Main component
├── SalesReviewReport.css          # Main styles
├── sections/
│   ├── KeyMetrics.jsx             # KPI cards display
│   ├── KeyMetrics.css
│   ├── PerformanceOverview.jsx    # Charts and trends
│   ├── PerformanceOverview.css
│   ├── BranchAnalysis.jsx         # Branch comparison
│   ├── BranchAnalysis.css
│   ├── TrendAnalysis.jsx          # Insights and trends
│   └── TrendAnalysis.css
└── utils/
    └── pptxGenerator.js           # PPTX generation logic
```

## Key Metrics Tracked

1. **Total Disbursements** - Monthly loan disbursements
2. **Active Clients** - Number of active borrowers
3. **Portfolio Outstanding** - Total loan portfolio
4. **Active Loans** - Number of active loans
5. **PAR > 30 Days** - Portfolio at risk over 30 days
6. **New Business** - Loans to new customers
7. **Repeat Business** - Loans to returning customers
8. **Portfolio Quality** - PAR ratio percentage

## Usage

### Accessing the Report
1. Navigate to Dashboard → Departmental Dashboard
2. Click on "SALES REVIEW REPORT" button
3. The report will load with current management data

### Generating PowerPoint
1. Select the desired review period using the month selector
2. Click "Generate PowerPoint" button
3. The PPTX file will be automatically downloaded

### Viewing Data
- Scroll through the report sections
- Each section is independently scrollable
- Charts are interactive (hover for details)
- Metrics update automatically when new management reports are uploaded

## Technical Details

### Dependencies
- **pptxgenjs** - PowerPoint generation library
- **recharts** - Data visualization library
- **react** - UI framework

### Data Processing
- Data is fetched from Management Dashboard's `useManagementData` hook
- Latest data points are used for current metrics
- Historical data (up to 12 months) is used for trend analysis
- Automatic sorting and aggregation by branch

### Performance
- Lazy loading of chart components
- Memoized data transformations
- Efficient data filtering by date range
- Responsive design for all screen sizes

## Customization

### Modifying Metrics
Edit `sections/KeyMetrics.jsx` to add/remove metrics or change calculations.

### Updating PPTX Template
Edit `utils/pptxGenerator.js` to modify:
- Slide layouts
- Color schemes
- Chart types
- Table structures
- Text formatting

### Adding New Sections
1. Create new component in `sections/` folder
2. Import and add to `SalesReviewReport.jsx`
3. Add corresponding styles in CSS file
4. Update PPTX generator if needed

## Color Scheme

The report uses a consistent color palette:
- **Primary**: `#2a5298` (Blue)
- **Success**: `#22c55e` (Green)
- **Warning**: `#f59e0b` (Orange)
- **Danger**: `#ef4444` (Red)
- **Info**: `#3b82f6` (Light Blue)

## Troubleshooting

### PPTX Not Generating
- Check browser console for errors
- Ensure management data is loaded
- Verify pptxgenjs is installed

### Missing Data
- Upload management reports first
- Check date range selection
- Verify data processing in backend

### Chart Not Displaying
- Ensure recharts is installed
- Check data format matches expected structure
- Verify component imports

## Future Enhancements

- [ ] Email delivery of PPTX reports
- [ ] Custom date range selection
- [ ] Export to PDF option
- [ ] Additional chart types
- [ ] Comparison with previous periods
- [ ] Drill-down into sub-branches
- [ ] Custom report templates
- [ ] Scheduled report generation

## Author
PCL Analysis System
Generated: February 2026
