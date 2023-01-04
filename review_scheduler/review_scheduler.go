// Copyright (c) 2022 Levi Gruspe
// License: GNU AGPLv3 or later

package review_scheduler

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/polycloze/polycloze/database"
	_ "github.com/mattn/go-sqlite3"
)

// Returns items due for review, no more than count.
// Pass a negative count if you want to get all due items.
func ScheduleReview[T database.Querier](q T, due time.Time, count int) ([]string, error) {
	query := `SELECT item FROM review WHERE due <= ? ORDER BY due LIMIT ?`
	rows, err := q.Query(query, due.Unix(), count)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []string
	for rows.Next() {
		var item string
		if err := rows.Scan(&item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

// Same as Schedule, but with some default args.
func ScheduleReviewNow[T database.Querier](q T, count int) ([]string, error) {
	return ScheduleReview(q, time.Now(), count)
}

// Same as ScheduleReviewNowWith, but takes a predicate argument.
// Only items that satisfy the predicate are included in the result.
func ScheduleReviewNowWith[T database.Querier](q T, count int, pred func(item string) bool) ([]string, error) {
	query := `SELECT item FROM review WHERE due <= ? ORDER BY due`
	rows, err := q.Query(query, time.Now().Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []string
	for rows.Next() && len(items) < count {
		var item string
		if err := rows.Scan(&item); err != nil {
			return nil, err
		}
		if pred(item) {
			items = append(items, item)
		}
	}
	return items, nil
}

// Gets most recent review of item.
func mostRecentReview(tx *sql.Tx, item string) (*Review, error) {
	query := `SELECT interval, reviewed FROM review WHERE item = ?`
	row := tx.QueryRow(query, item)
	var review Review

	var interval time.Duration
	var reviewed int64
	err := row.Scan(
		&interval,
		&reviewed,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	review.Reviewed = time.Unix(reviewed, 0)
	review.Interval = interval * time.Hour
	return &review, nil
}

// Same as `UpdateReviewAt`, but explicitly takes an `*sql.Tx`.
func UpdateReviewAtTx(tx *sql.Tx, result Result, now time.Time) error {
	review, err := mostRecentReview(tx, result.Word)
	if err != nil {
		return fmt.Errorf("failed to update review: %w", err)
	}

	if review == nil || !now.Before(review.Due()) {
		// Only update interval stats if the student didn't cram
		if err := updateIntervalStats(tx, review, result.Correct); err != nil {
			return fmt.Errorf("failed to update review: %w", err)
		}
	}

	next, err := nextReview(tx, review, result.Correct, now)
	if err != nil {
		return fmt.Errorf("failed to update review: %w", err)
	}

	query := `
		INSERT INTO review (item, interval, learned, reviewed)
		VALUES (@item, @interval, @now, @now)
		ON CONFLICT (item) DO UPDATE SET
			interval = excluded.interval,
			reviewed = excluded.reviewed
	`
	_, err = tx.Exec(
		query,
		sql.Named("item", result.Word),
		sql.Named("interval", int64(next.Interval.Hours())),
		sql.Named("now", now.Unix()),
	)
	if err != nil {
		return fmt.Errorf("failed to update review: %w", err)
	}
	if err := autoTune(tx); err != nil {
		return fmt.Errorf("failed to update review: %w", err)
	}

	return nil
}

// Updates review status of item.
func UpdateReviewAt[T database.Querier](q T, item string, correct bool, now time.Time) error {
	tx, err := q.Begin()
	if err != nil {
		return fmt.Errorf("failed to update review: %w", err)
	}

	result := Result{
		Word:    item,
		Correct: correct,
	}
	if err := UpdateReviewAtTx(tx, result, now); err != nil {
		return fmt.Errorf("failed to update review: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to update review: %w", err)
	}
	return nil
}

func UpdateReview[T database.Querier](q T, item string, correct bool) error {
	return UpdateReviewAt(q, item, correct, time.Now().UTC())
}

// Saves reviews in bulk.
func BulkSaveReviews[T database.Querier](q T, reviews []Result, now time.Time) error {
	tx, err := q.Begin()
	if err != nil {
		return fmt.Errorf("failed to save reviews in bulk: %w", err)
	}

	// Best-effort save.
	for _, review := range reviews {
		_ = UpdateReviewAtTx(tx, review, now)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to save reviews in bulk: %w", err)
	}
	return nil
}
