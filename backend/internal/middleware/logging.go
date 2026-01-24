package middleware

import (
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// LoggingMiddleware logs request details
func LoggingMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Start timer
		start := time.Now()
		path := c.Request.URL.Path
		query := c.Request.URL.RawQuery

		// Process request
		c.Next()

		// Calculate latency
		latency := time.Since(start)

		// Get status code
		status := c.Writer.Status()

		// Get client IP
		clientIP := c.ClientIP()

	// Get user ID if authenticated
	userID := ""
	if id, exists := c.Get("userId"); exists {
		// Handle both string and uuid.UUID types
		switch v := id.(type) {
		case string:
			userID = v
		default:
			userID = fmt.Sprintf("%v", v)
		}
	}

		// Log format: timestamp | status | latency | clientIP | method | path | userID | errors
		if len(c.Errors) > 0 {
			log.Printf("[API] %d | %13v | %15s | %-7s %s%s | user:%s | %s",
				status,
				latency,
				clientIP,
				c.Request.Method,
				path,
				formatQuery(query),
				userID,
				c.Errors.ByType(gin.ErrorTypePrivate).String(),
			)
		} else {
			log.Printf("[API] %d | %13v | %15s | %-7s %s%s | user:%s",
				status,
				latency,
				clientIP,
				c.Request.Method,
				path,
				formatQuery(query),
				userID,
			)
		}

		// Log slow requests
		if latency > 500*time.Millisecond {
			log.Printf("[SLOW] Request took %v: %s %s", latency, c.Request.Method, path)
		}
	}
}

func formatQuery(query string) string {
	if query != "" {
		return "?" + query
	}
	return ""
}

// RecoveryMiddleware recovers from panics and logs them
func RecoveryMiddleware() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, recovered interface{}) {
		log.Printf("[PANIC] %v\nPath: %s\nMethod: %s\n",
			recovered,
			c.Request.URL.Path,
			c.Request.Method,
		)

		// Only write error response if headers haven't been sent yet
		if !c.Writer.Written() {
			c.JSON(500, gin.H{
				"success": false,
				"error":   "Internal server error",
			})
		} else {
			// Headers already written, just abort
			c.Abort()
		}
	})
}
