// Copyright (c) 2022 Levi Gruspe
// License: GNU AGPLv3 or later

// sync db migrations.
package database

import (
	"database/sql"
	"fmt"

	"github.com/pressly/goose/v3"
)

// Upgrades sync db to the latest version.
func upgradeSyncDB(db *sql.DB) error {
	return goose.Up(db, "migrations/sync")
}

// NOTE Caller has to close the db.
func OpenSyncDB(path string) (*sql.DB, error) {
	db, err := Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open sync database: %v", err)
	}
	if err := upgradeSyncDB(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to upgrade sync database: %v", err)
	}
	return db, nil
}
