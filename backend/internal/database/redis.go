package database

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/pcl/pcl-api/internal/config"
	"github.com/redis/go-redis/v9"
)

var Redis *redis.Client
var ctx = context.Background()

// InitRedis initializes the Redis connection
func InitRedis(cfg *config.RedisConfig) error {
	Redis = redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%s", cfg.Host, cfg.Port),
		Password: cfg.Password,
		DB:       cfg.DB,
	})

	// Test connection
	_, err := Redis.Ping(ctx).Result()
	if err != nil {
		log.Printf("⚠ Redis connection failed: %v (caching disabled)", err)
		Redis = nil
		return nil // Don't fail if Redis is unavailable
	}

	log.Println("✓ Redis connected successfully")
	return nil
}

// CloseRedis closes the Redis connection
func CloseRedis() {
	if Redis != nil {
		Redis.Close()
	}
}

// Cache helpers

// Set stores a value in cache with expiration
func CacheSet(key string, value interface{}, expiration time.Duration) error {
	if Redis == nil {
		return nil // Silently skip if Redis not available
	}

	data, err := json.Marshal(value)
	if err != nil {
		return err
	}

	return Redis.Set(ctx, key, data, expiration).Err()
}

// Get retrieves a value from cache
func CacheGet(key string, dest interface{}) error {
	if Redis == nil {
		return redis.Nil // Return cache miss if Redis not available
	}

	data, err := Redis.Get(ctx, key).Bytes()
	if err != nil {
		return err
	}

	return json.Unmarshal(data, dest)
}

// Delete removes a key from cache
func CacheDelete(key string) error {
	if Redis == nil {
		return nil
	}

	return Redis.Del(ctx, key).Err()
}

// DeletePattern removes all keys matching a pattern
func CacheDeletePattern(pattern string) error {
	if Redis == nil {
		return nil
	}

	iter := Redis.Scan(ctx, 0, pattern, 0).Iterator()
	for iter.Next(ctx) {
		if err := Redis.Del(ctx, iter.Val()).Err(); err != nil {
			return err
		}
	}
	return iter.Err()
}

// Exists checks if a key exists in cache
func CacheExists(key string) bool {
	if Redis == nil {
		return false
	}

	result, err := Redis.Exists(ctx, key).Result()
	return err == nil && result > 0
}

// Cache key generators
const (
	CacheKeyDashboard     = "dashboard:%s:%s"      // department:date_range
	CacheKeyReports       = "reports:%s:%s"        // department:type
	CacheKeyUser          = "user:%s"              // user_id
	CacheKeyReportData    = "report_data:%s"       // report_id
	CacheTTLDashboard     = 5 * time.Minute
	CacheTTLReports       = 10 * time.Minute
	CacheTTLUser          = 1 * time.Hour
)

// GetDashboardCacheKey generates a cache key for dashboard data
func GetDashboardCacheKey(department, dateRange string) string {
	return fmt.Sprintf(CacheKeyDashboard, department, dateRange)
}

// GetReportsCacheKey generates a cache key for reports list
func GetReportsCacheKey(department, reportType string) string {
	return fmt.Sprintf(CacheKeyReports, department, reportType)
}

// GetUserCacheKey generates a cache key for user data
func GetUserCacheKey(userID string) string {
	return fmt.Sprintf(CacheKeyUser, userID)
}

// InvalidateDashboardCache invalidates all dashboard cache entries
func InvalidateDashboardCache() error {
	return CacheDeletePattern("dashboard:*")
}

// InvalidateReportsCache invalidates all reports cache entries
func InvalidateReportsCache() error {
	return CacheDeletePattern("reports:*")
}
