# Backend Optimization Guide

## Database Indexes Migration

To improve query performance, run the database indexes migration:

```bash
# Using psql
psql -U your_user -d your_database -f migrations/007_add_report_data_indexes.sql

# Or using the Go migration tool if you have one
```

## Performance Improvements

### 1. Connection Pooling
- **Max Open Connections**: 50 (increased from 25)
- **Max Idle Connections**: 25 (50% of max)
- **Connection Lifetime**: 10 minutes
- **Idle Timeout**: 5 minutes

### 2. Query Optimizations
- Added `INNER JOIN` instead of `JOIN` for clarity
- Added `IS NOT NULL` checks to filter invalid data
- Improved error handling with row iteration checks
- Filter out rows with no metric values before returning

### 3. Data Validation
- Only include rows with at least one non-zero metric value
- Validate metric values before adding to result set
- Better error messages for debugging

## ETL Pipeline Improvements

### Batch Data Fetching
- Single query instead of N queries (where N = number of reports)
- Efficient grouping in database instead of in-memory
- Proper use of indexes for fast lookups

### Caching Strategy
- Redis caching for frequently accessed data
- Cache TTL: 5-10 minutes depending on data type
- Cache invalidation on data updates

## Monitoring

Check slow queries in logs (queries > 100ms are logged):
```bash
tail -f logs/app.log | grep "Slow query"
```

## Expected Performance Gains

- **Regional Data Fetching**: 5-10x faster with indexes
- **Batch Operations**: 10-20x faster (single query vs N queries)
- **Concurrent Requests**: Better handling with increased connection pool
- **Memory Usage**: Reduced by filtering invalid data early
