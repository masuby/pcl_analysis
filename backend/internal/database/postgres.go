package database

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"
	"github.com/pcl/pcl-api/internal/config"
)

var DB *sql.DB

// InitPostgres initializes the PostgreSQL connection
func InitPostgres(cfg *config.DatabaseConfig) error {
	var err error

	dsn := cfg.GetDSN()
	DB, err = sql.Open("postgres", dsn)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	// Configure connection pool for optimal performance
	// Increased for better concurrent request handling
	DB.SetMaxOpenConns(50)                    // Maximum open connections
	DB.SetMaxIdleConns(25)                    // Maximum idle connections (50% of max)
	DB.SetConnMaxLifetime(10 * time.Minute)  // Connection lifetime
	DB.SetConnMaxIdleTime(5 * time.Minute)   // Idle connection timeout

	// Test connection
	if err = DB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	log.Println("✓ PostgreSQL connected successfully")
	return nil
}

// Close closes the database connection
func Close() {
	if DB != nil {
		DB.Close()
	}
}

// Transaction helper for running multiple queries in a transaction
func WithTransaction(fn func(*sql.Tx) error) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}

	defer func() {
		if p := recover(); p != nil {
			tx.Rollback()
			panic(p)
		}
	}()

	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit()
}

// QueryRow is a helper that logs slow queries
func QueryRow(query string, args ...interface{}) *sql.Row {
	start := time.Now()
	row := DB.QueryRow(query, args...)
	duration := time.Since(start)
	if duration > 100*time.Millisecond {
		log.Printf("Slow query (%v): %s", duration, query)
	}
	return row
}

// Query is a helper that logs slow queries
func Query(query string, args ...interface{}) (*sql.Rows, error) {
	start := time.Now()
	rows, err := DB.Query(query, args...)
	duration := time.Since(start)
	if duration > 100*time.Millisecond {
		log.Printf("Slow query (%v): %s", duration, query)
	}
	return rows, err
}

// Exec is a helper that logs slow queries
func Exec(query string, args ...interface{}) (sql.Result, error) {
	start := time.Now()
	result, err := DB.Exec(query, args...)
	duration := time.Since(start)
	if duration > 100*time.Millisecond {
		log.Printf("Slow query (%v): %s", duration, query)
	}
	return result, err
}
