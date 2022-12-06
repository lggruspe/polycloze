// Copyright (c) 2022 Levi Gruspe
// License: GNU AGPLv3 or later

package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/lggruspe/polycloze/auth"
	"github.com/lggruspe/polycloze/basedir"
	"github.com/lggruspe/polycloze/database"
	"github.com/lggruspe/polycloze/sessions"
)

type ReviewSchema struct {
	Word           string    `json:"word"`
	Learned        time.Time `json:"learned"`
	Reviewed       time.Time `json:"reviewed"`
	Interval       int       `json:"interval"`
	SequenceNumber int       `json:"sequenceNumber"`
}

type SyncSchema struct {
	Latest          int            `json:"latest"` // sequence number
	Reviews         []ReviewSchema `json:"reviews"`
	DifficultyStats string         `json:"difficultyStats"`
	IntervalStats   string         `json:"intervalStats"`
}

// Returns more recent reviews.
func moreRecent(db *sql.DB, sequenceNumber int) ([]ReviewSchema, error) {
	var reviews []ReviewSchema

	query := `
		SELECT word, learned, reviewed, interval, sequence_number
		FROM review
		WHERE sequence_number > ?
		ORDER BY sequence_number ASC
	`
	rows, err := db.Query(query, sequenceNumber)
	if err != nil {
		return nil, fmt.Errorf("failed to get more recent reviews: %v", err)
	}
	defer rows.Close()

	for rows.Next() {
		var review ReviewSchema
		var learned, reviewed int64
		err := rows.Scan(
			&review.Word,
			&learned,
			&reviewed,
			&review.Interval,
			&review.SequenceNumber,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to get more recent reviews: %v", err)
		}

		review.Learned = time.Unix(learned, 0)
		review.Reviewed = time.Unix(reviewed, 0)
		reviews = append(reviews, review)
	}
	return reviews, nil
}

func getAllStats(db *sql.DB) (map[string]string, error) {
	stats := make(map[string]string)
	query := `SELECT value FROM stat WHERE name = ?`

	var difficulty, interval string
	err := db.QueryRow(query, "difficulty").Scan(&difficulty)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("failed to get stats: %v", err)
		}
		difficulty = ""
	}

	err = db.QueryRow(query, "interval").Scan(&difficulty)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("failed to get stats: %v", err)
		}
		interval = ""
	}

	stats["difficultyStats"] = difficulty
	stats["intervalStats"] = interval
	return stats, nil
}

// Syncs client database with server.
func handleSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.NotFound(w, r)
		return
	}

	if r.Header.Get("Content-Type") != "application/json" {
		http.Error(w, "expected json body in POST request", http.StatusBadRequest)
		return
	}

	// Read body.
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Could not read request.", http.StatusInternalServerError)
		return
	}

	l1 := chi.URLParam(r, "l1")
	l2 := chi.URLParam(r, "l2")
	if !courseExists(l1, l2) {
		http.NotFound(w, r)
		return
	}

	db := auth.GetDB(r)
	s, err := sessions.ResumeSession(db, w, r)
	if err != nil || !isSignedIn(s) {
		http.Error(w, "Forbidden.", http.StatusForbidden)
		return
	}

	// Check csrf token in HTTP headers.
	if !sessions.CheckCSRFToken(s.ID, r.Header.Get("X-CSRF-Token")) {
		http.Error(w, "Forbidden.", http.StatusForbidden)
		return
	}

	userID := s.Data["userID"].(int)
	db, err = database.OpenSyncDB(basedir.Sync(userID, l1, l2))
	if err != nil {
		log.Println(fmt.Errorf("could not open sync database (%v-%v): %v", l1, l2, err))
		http.Error(w, "Something went wrong.", http.StatusInternalServerError)
		return
	}
	defer db.Close()

	// Parse JSON body.
	var data SyncSchema
	if err := json.Unmarshal(body, &data); err != nil {
		http.Error(w, "could not parse json", http.StatusBadRequest)
		return
	}

	// Get most recent reviews
	reviews, err := moreRecent(db, data.Latest)
	if err != nil {
		log.Println(err)
		http.Error(w, "Something went wrong.", http.StatusInternalServerError)
		return
	}

	if len(reviews) > 0 {
		// If there are more recent reviews (conflicts), the client should replace
		// unacknowledged reviews with the newer ones.
		stats, err := getAllStats(db)
		if err != nil {
			log.Println(err)
			http.Error(w, "Something went wrong.", http.StatusInternalServerError)
			return
		}
		sendJSON(w, map[string]any{
			"reviews":         reviews,
			"difficultyStats": stats["difficultyStats"],
			"intervalStats":   stats["intervalStats"],
		})
		return
	}

	// Save uploaded reviews and stats if there are no conflicts.
	if err := saveReviews(db, data.Reviews); err != nil {
		log.Println(err)
		http.Error(w, "Something went wrong.", http.StatusInternalServerError)
		return
	}

	// Empty response means ACK'ed without conflicts.
	sendJSON(w, map[string]any{})
}

// Saves uploaded reviews.
func saveReviews(db *sql.DB, reviews []ReviewSchema) error {
	query := `
		INSERT INTO review (word, learned, reviewed, interval, sequence_number)
		VALUES (?, ?, ?, ?, ?)
	`
	for _, review := range reviews {
		if _, err := db.Exec(
			query,
			review.Word,
			review.Learned.Unix(),
			review.Reviewed.Unix(),
			review.Interval,
			review.SequenceNumber,
		); err != nil {
			return fmt.Errorf("failed to save uploaded reviews: %v", err)
		}
	}
	return nil
}
