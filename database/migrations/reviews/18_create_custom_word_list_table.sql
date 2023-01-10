-- Copyright (c) 2023 Levi Gruspe
-- License: MIT, or AGPLv3 or later

-- +goose Up

CREATE TABLE IF NOT EXISTS custom_list (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL	
);

CREATE TABLE IF NOT EXISTS custom_list_word (
	deck INTEGER NOT NULL REFERENCES custom_list ON DELETE CASCADE,
	word TEXT NOT NULL,
	UNIQUE (deck, word)
);

CREATE INDEX IF NOT EXISTS index_custom_list_word_deck ON custom_list_word (deck);

-- +goose Down

DROP INDEX IF EXISTS index_custom_list_word_deck;

DROP TABLE IF EXISTS custom_list_word;

DROP TABLE IF EXISTS custom_list;
