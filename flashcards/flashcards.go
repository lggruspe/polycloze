// Copyright (c) 2022 Levi Gruspe
// License: GNU AGPLv3 or later

package flashcards

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/lggruspe/polycloze/database"
	"github.com/lggruspe/polycloze/sentences"
	"github.com/lggruspe/polycloze/translator"
	"github.com/lggruspe/polycloze/word_scheduler"
)

// Different from sentences.Sentence
type Sentence struct {
	ID        int    `json:"id"`    // id in database
	Parts     []Part `json:"parts"` // Odd-numbers parts are blanks
	TatoebaID int64  `json:"tatoebaID,omitempty"`
}

type Item struct {
	Sentence    Sentence               `json:"sentence"`
	Translation translator.Translation `json:"translation"`
}

type ItemGenerator struct {
	db       *sql.DB
	courseDB string // to be attached
}

// Creates an ItemGenerator.
func NewItemGenerator(db *sql.DB, courseDB string) ItemGenerator {
	return ItemGenerator{
		db:       db,
		courseDB: courseDB,
	}
}

func generateWords(
	db *sql.DB,
	n int,
	pred func(word string) bool,
	hooks ...database.ConnectionHook,
) ([]string, error) {
	ctx := context.TODO()
	con, err := database.NewConnection(db, ctx, hooks...)
	if err != nil {
		return nil, err
	}
	defer con.Close()
	return word_scheduler.GetWordsWith(con, n, pred)
}

func generateItem[T database.Querier](q T, word string) (Item, error) {
	var item Item

	sentence, err := sentences.PickSentence(q, word)
	if err != nil {
		return item, err
	}

	translation, err := translator.Translate(q, sentence)
	if err != nil {
		panic(fmt.Errorf("could not translate sentence (%v): %v", sentence, err))
	}
	return Item{
		Translation: translation,
		Sentence: Sentence{
			ID:        sentence.ID,
			Parts:     getParts(sentence.Tokens, word),
			TatoebaID: sentence.TatoebaID,
		},
	}, nil
}

// Creates a cloze item for each word.
func generateItems(db *sql.DB, words []string, hooks ...database.ConnectionHook) []Item {
	ch := make(chan Item, len(words))
	generateItemsIntoChannel(db, ch, words, hooks...)
	close(ch)

	items := make([]Item, 0)
	for item := range ch {
		items = append(items, item)
	}
	return items
}

// Enter functions are invoked in a FIFO manner, while Exit functions are deferred.
func generateItemsIntoChannel(
	db *sql.DB,
	ch chan Item,
	words []string,
	hooks ...database.ConnectionHook,
) {
	// TODO use request context instead
	ctx := context.TODO()
	con, err := database.NewConnection(db, ctx, hooks...)
	if err != nil {
		return
	}
	defer con.Close()

	for _, word := range words {
		if item, err := generateItem(con, word); err == nil {
			ch <- item
		}
	}
}

// Returns list of flashcards to show.
// n: max number of flashcards to return.
func Get(
	db *sql.DB,
	n int,
	pred func(word string) bool,
	hooks ...database.ConnectionHook,
) []Item {
	words, err := generateWords(db, n, pred, hooks...)
	if err != nil {
		return nil
	}
	return generateItems(db, words, hooks...)
}

// Similar to `generateItems` but takes a course DB instead of a review DB.
func GetItems(db *sql.DB, words []string) ([]Item, error) {
	var items []Item
	for _, word := range words {
		sentence, err := sentences.PickSentence(db, word)
		if err != nil {
			return nil, fmt.Errorf("failed to generate flashcards: %v", err)
		}

		translation, err := translator.Translate(db, sentence)
		if err != nil {
			return nil, fmt.Errorf("failed to generate flashcards: %v", err)
		}

		item := Item{
			Translation: translation,
			Sentence: Sentence{
				ID:        sentence.ID,
				Parts:     getParts(sentence.Tokens, word),
				TatoebaID: sentence.TatoebaID,
			},
		}

		items = append(items, item)
	}
	return items, nil
}
