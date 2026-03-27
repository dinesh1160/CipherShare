package database

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

func InitDB(dbPath string) error {
	if dbPath == "" {
		return errors.New("database path is required")
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("open sqlite database: %w", err)
	}

	// Keep a healthy pool for concurrent API requests.
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(25)

	if _, err := db.Exec("PRAGMA journal_mode = WAL;"); err != nil {
		_ = db.Close()
		return fmt.Errorf("enable WAL mode: %w", err)
	}

	if _, err := db.Exec("PRAGMA foreign_keys = ON;"); err != nil {
		_ = db.Close()
		return fmt.Errorf("enable foreign keys: %w", err)
	}

	if _, err := db.Exec("PRAGMA busy_timeout = 5000;"); err != nil {
		_ = db.Close()
		return fmt.Errorf("set busy_timeout: %w", err)
	}

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return fmt.Errorf("ping sqlite database: %w", err)
	}

	DB = db
	log.Printf("sqlite initialized at %s", dbPath)
	return nil
}

func RunMigrations() error {
	if DB == nil {
		return errors.New("database is not initialized")
	}

	if _, err := DB.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`); err != nil {
		return fmt.Errorf("create schema_migrations table: %w", err)
	}

	migrations := []struct {
		version      string
		tableToCheck string
	}{
		{version: "000001_create_users.sql", tableToCheck: "users"},
		{version: "000002_create_files.sql", tableToCheck: "files"},
		{version: "000003_create_chunks.sql", tableToCheck: "file_chunks"},
	}

	for _, migration := range migrations {
		if err := applyMigration(migration.version, migration.tableToCheck); err != nil {
			return err
		}
	}

	return nil
}

func applyMigration(version string, tableToCheck string) error {
	migrationPath := filepath.Join("database", "migrations", version)

	var appliedCount int
	err := DB.QueryRow("SELECT COUNT(1) FROM schema_migrations WHERE version = ?", version).Scan(&appliedCount)
	if err != nil {
		return fmt.Errorf("check migration state for %s: %w", version, err)
	}

	if appliedCount > 0 {
		log.Printf("migration already applied: %s", version)
		return nil
	}

	var tableExists int
	err = DB.QueryRow("SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = ?", tableToCheck).Scan(&tableExists)
	if err != nil {
		return fmt.Errorf("check table existence for %s: %w", tableToCheck, err)
	}

	if tableExists > 0 {
		if _, err := DB.Exec("INSERT INTO schema_migrations(version) VALUES(?)", version); err != nil {
			return fmt.Errorf("record existing migration %s: %w", version, err)
		}
		log.Printf("table %s already exists, marked migration as applied: %s", tableToCheck, version)
		return nil
	}

	sqlBytes, err := os.ReadFile(migrationPath)
	if err != nil {
		return fmt.Errorf("read migration file %s: %w", migrationPath, err)
	}

	tx, err := DB.Begin()
	if err != nil {
		return fmt.Errorf("begin migration transaction for %s: %w", version, err)
	}

	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	if _, err = tx.Exec(string(sqlBytes)); err != nil {
		return fmt.Errorf("apply migration %s: %w", version, err)
	}

	if _, err = tx.Exec("INSERT INTO schema_migrations(version) VALUES(?)", version); err != nil {
		return fmt.Errorf("record migration %s: %w", version, err)
	}

	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit migration transaction for %s: %w", version, err)
	}

	log.Printf("applied migration: %s", version)
	return nil
}
