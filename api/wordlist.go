// Copyright (c) 2023 Levi Gruspe
// License: GNU AGPLv3 or later

package api

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/polycloze/polycloze/auth"
	"github.com/polycloze/polycloze/basedir"
	"github.com/polycloze/polycloze/database"
	"github.com/polycloze/polycloze/sessions"
	"github.com/polycloze/polycloze/text"
)

type WordList struct {
	ID   int64
	Name string
}

// GET: Responds with list of custom word lists.
// POST: Creates a new word list.
// POST request body should contain `name` of the list.
func handleWordLists(w http.ResponseWriter, r *http.Request) {
	// Check if course exists.
	l1 := chi.URLParam(r, "l1")
	l2 := chi.URLParam(r, "l2")
	if !courseExists(l1, l2) {
		http.NotFound(w, r)
		return
	}

	// Sign in.
	db := auth.GetDB(r)
	s, err := sessions.ResumeSession(db, w, r)
	if err != nil || !s.IsSignedIn() {
		http.NotFound(w, r)
		return
	}

	// Open user's review DB.
	userID := s.Data["userID"].(int)
	db, err = database.OpenReviewDB(basedir.Review(userID, l1, l2))
	if err != nil {
		log.Println(fmt.Errorf("could not open review database (%v-%v): %w", l1, l2, err))
		http.Error(w, "Something went wrong.", http.StatusInternalServerError)
		return
	}
	defer db.Close()

	if r.Method == "POST" {
		// Read request body.
		body, err := io.ReadAll(r.Body)
		if err != nil {
			log.Println(err)
			http.Error(w, "Could not read request.", http.StatusInternalServerError)
			return
		}

		var data CreateWordListRequest
		if err := parseJSON(w, body, &data); err != nil {
			return
		}

		id, err := createWordList(db, data.Name)
		if err != nil {
			log.Println(err)
			http.Error(w, "Something went wrong.", http.StatusInternalServerError)
			return
		}

		sendJSON(w, CreateWordListResponse{
			WordLists: []WordList{
				{
					ID:   id,
					Name: data.Name,
				},
			},
		})
		return
	}

	// Respond with list of word lists.
	lists, err := getWordLists(db)
	if err != nil {
		log.Println(err)
		http.Error(w, "Something went wrong.", http.StatusInternalServerError)
		return
	}
	sendJSON(w, CreateWordListResponse{
		WordLists: lists,
	})
}

// GET: Responds with requested word list.
// PUT: Renames list/adds word into list/deletes word from list.
func handleWordListWords(w http.ResponseWriter, r *http.Request) {
	l1 := chi.URLParam(r, "l1")
	l2 := chi.URLParam(r, "l2")
	if !courseExists(l1, l2) {
		http.NotFound(w, r)
		return
	}

	// Sign in.
	db := auth.GetDB(r)
	s, err := sessions.ResumeSession(db, w, r)
	if err != nil || !s.IsSignedIn() {
		http.NotFound(w, r)
		return
	}

	// Open user's review DB.
	userID := s.Data["userID"].(int)
	db, err = database.OpenReviewDB(basedir.Review(userID, l1, l2))
	if err != nil {
		log.Println(fmt.Errorf("could not open review database (%v-%v): %w", l1, l2, err))
		http.Error(w, "Something went wrong.", http.StatusInternalServerError)
		return
	}
	defer db.Close()

	// Get word list ID from URL.
	id := chi.URLParam(r, "id")

	if r.Method == "PUT" {
		// Read request body.
		body, err := io.ReadAll(r.Body)
		if err != nil {
			log.Println(err)
			http.Error(w, "Could not read request.", http.StatusInternalServerError)
			return
		}

		var data UpdateWordListRequest
		if err := parseJSON(w, body, &data); err != nil {
			return
		}

		if data.Rename != "" {
			if err := renameWordList(db, id, data.Rename); err != nil {
				log.Println(err)
				http.Error(w, "Something went wrong.", http.StatusInternalServerError)
				return
			}
		}

		if data.Add != "" {
			if err := addListWord(db, id, data.Add); err != nil {
				log.Println(err)
				http.Error(w, "Something went wrong.", http.StatusInternalServerError)
				return
			}
		}

		if data.Delete != "" {
			if err := deleteListWord(db, id, data.Delete); err != nil {
				log.Println(err)
				http.Error(w, "Something went wrong.", http.StatusInternalServerError)
				return
			}
		}

		// Sends empty response (means success).
		sendJSON(w, map[string][]string{
			"words": nil,
		})
		return
	}

	words, err := getWordList(db, id)
	if err != nil {
		log.Println(err)
		http.Error(w, "Something went wrong.", http.StatusInternalServerError)
		return
	}
	sendJSON(w, map[string][]string{
		"words": words,
	})
}

// Creates a new word list with the given name.
// Returns the ID of the list.
func createWordList(db *sql.DB, name string) (int64, error) {
	query := `INSERT INTO custom_list (name) VALUES (?)`
	result, err := db.Exec(query, name)
	if err != nil {
		return 0, fmt.Errorf("failed to create word list: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("failed to ID of created word list: %w", err)
	}
	return id, nil
}

// Returns all word lists in DB.
func getWordLists(db *sql.DB) ([]WordList, error) {
	query := `SELECT id, name FROM custom_list`
	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to get word lists: %w", err)
	}
	defer rows.Close()

	lists := make([]WordList, 0)
	for rows.Next() {
		var list WordList
		if err := rows.Scan(&list.ID, &list.Name); err != nil {
			return nil, fmt.Errorf("failed to get word lists: %w", err)
		}
		lists = append(lists, list)
	}
	return lists, nil
}

// Returns list of words in a word list.
// Not to be confused with `getWordLists`.
func getWordList(db *sql.DB, sid string) ([]string, error) {
	id, err := strconv.ParseInt(sid, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("failed to get words in list: %w", err)
	}

	query := `SELECT word FROM custom_list_word WHERE deck = ?`
	rows, err := db.Query(query, id)
	if err != nil {
		return nil, fmt.Errorf("failed to get words in list: %w", err)
	}
	defer rows.Close()

	words := make([]string, 0)
	for rows.Next() {
		var word string
		if err := rows.Scan(&word); err != nil {
			return nil, fmt.Errorf("failed to get words in list: %w", err)
		}
		words = append(words, word)
	}
	return words, nil
}

// Renames word list.
func renameWordList(db *sql.DB, sid string, name string) error {
	id, err := strconv.ParseInt(sid, 10, 64)
	if err != nil {
		return fmt.Errorf("failed to rename word list: %w", err)
	}
	query := `UPDATE custom_list SET name = ? WHERE id = ?`
	if _, err := db.Exec(query, name, id); err != nil {
		return fmt.Errorf("failed to rename word list: %w", err)
	}
	return nil
}

// Adds word to word list.
func addListWord(db *sql.DB, sid, word string) error {
	id, err := strconv.ParseInt(sid, 10, 64)
	if err != nil {
		return fmt.Errorf("failed to add word to word list: %w", err)
	}
	word = text.Casefold(word)
	query := `INSERT OR IGNORE INTO custom_list_word (id, word) VALUES (?, ?)`
	if _, err := db.Exec(query, id, word); err != nil {
		return fmt.Errorf("failed to add word to word list: %w", err)
	}
	return nil
}

// Deletes word from word list.
func deleteListWord(db *sql.DB, sid, word string) error {
	id, err := strconv.ParseInt(sid, 10, 64)
	if err != nil {
		return fmt.Errorf("failed to delete word from word list: %w", err)
	}
	word = text.Casefold(word)
	query := `DELETE FROM custom_list_word WHERE (id, word) = (?, ?)`
	if _, err := db.Exec(query, id, word); err != nil {
		return fmt.Errorf("failed to delete word from word list: %w", err)
	}
	return nil
}
