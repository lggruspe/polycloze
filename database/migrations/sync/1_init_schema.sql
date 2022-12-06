-- Copyright (c) 2022 Levi Gruspe
-- License: MIT, or AGPLv3 or later

--- For syncing indexedDB with server SQLite files.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE review (
	word TEXT PRIMARY KEY,
	learned INTEGER NOT NULL DEFAULT (unixepoch('now')),
	reviewed INTEGER NOT NULL DEFAULT (unixepoch('now')),
	interval INTEGER NOT NULL,
	sequence_number INTEGER UNIQUE NOT NULL,
	due INTEGER NOT NULL GENERATED ALWAYS AS (reviewed + 3600*interval) VIRTUAL,
	correct BOOLEAN GENERATED ALWAYS AS (interval > 0) VIRTUAL
);

CREATE TABLE stat (
	name TEXT PRIMARY KEY,
	value TEXT NOT NULL	-- json
);

CREATE TABLE activity (
	-- Number of days since UNIX epoch
	days_since_epoch INTEGER UNIQUE NOT NULL DEFAULT (unixepoch('now') / 60 / 60 / 24),
	forgotten INTEGER NOT NULL DEFAULT 0,
	unimproved INTEGER NOT NULL DEFAULT 0,
	crammed INTEGER NOT NULL DEFAULT 0,
	learned INTEGER NOT NULL DEFAULT 0,
	strengthened INTEGER NOT NULL DEFAULT 0
);

CREATE TRIGGER activity_trigger_after_insert_correct_review
AFTER INSERT ON review
FOR EACH ROW
	WHEN NEW.correct
		BEGIN
			INSERT INTO activity (learned)
			VALUES (1)
			ON CONFLICT (days_since_epoch) DO UPDATE SET
				learned = learned + 1;
		END;

CREATE TRIGGER activity_trigger_after_insert_incorrect_review
AFTER INSERT ON review
FOR EACH ROW
	WHEN NEW.correct IS NOT true
		BEGIN
			INSERT INTO activity (unimproved)
			VALUES (1)
			ON CONFLICT (days_since_epoch) DO UPDATE SET
				unimproved = unimproved + 1;
		END;

CREATE TRIGGER activity_trigger_after_update_strengthened_review
AFTER UPDATE OF reviewed ON review
FOR EACH ROW
	WHEN OLD.correct AND NEW.correct AND (NEW.interval > OLD.interval)
		BEGIN
			INSERT INTO activity (strengthened)
			VALUES (1)
			ON CONFLICT (days_since_epoch) DO UPDATE SET
				strengthened = strengthened + 1;
		END;

CREATE TRIGGER activity_trigger_after_update_crammed_review
AFTER UPDATE OF reviewed ON review
FOR EACH ROW
	WHEN OLD.correct AND NEW.correct AND NEW.interval <= OLD.interval
		BEGIN
			INSERT INTO activity (crammed)
			VALUES (1)
			ON CONFLICT (days_since_epoch) DO UPDATE SET
				crammed = crammed + 1;
		END;

CREATE TRIGGER activity_trigger_after_update_forgotten_review
AFTER UPDATE OF reviewed ON review
FOR EACH ROW
	WHEN OLD.correct AND (NEW.correct IS NOT true)
		BEGIN
			INSERT INTO activity (forgotten)
			VALUES (1)
			ON CONFLICT (days_since_epoch) DO UPDATE SET
				forgotten = forgotten + 1;
		END;

CREATE TRIGGER activity_trigger_after_update_learned_review
AFTER UPDATE OF reviewed ON review
FOR EACH ROW
	WHEN NEW.correct AND (OLD.correct IS NOT TRUE)
		BEGIN
			INSERT INTO activity (learned)
			VALUES (1)
			ON CONFLICT (days_since_epoch) DO UPDATE SET
				learned = learned + 1;
		END;

CREATE TRIGGER activity_trigger_after_update_unimproved_review
AFTER UPDATE OF reviewed ON review
FOR EACH ROW
	WHEN (NEW.correct IS NOT true) AND (OLD.correct IS NOT true)
		BEGIN
			INSERT INTO activity (unimproved)
			VALUES (1)
			ON CONFLICT (days_since_epoch) DO UPDATE SET
				unimproved = unimproved + 1;
		END;

CREATE TRIGGER activity_trigger_after_delete_correct_review
AFTER DELETE ON review
FOR EACH ROW
	WHEN OLD.correct
		BEGIN
			INSERT INTO activity (forgotten)
			VALUES (1)
			ON CONFLICT (days_since_epoch) DO UPDATE SET
				forgotten = forgotten + 1;
		END;

CREATE TRIGGER activity_trigger_after_delete_incorrect_review
AFTER DELETE ON review
FOR EACH ROW
	WHEN OLD.correct IS NOT true
		BEGIN
			INSERT INTO activity (unimproved)
			VALUES (1)
			ON CONFLICT (days_since_epoch) DO UPDATE SET
				unimproved = unimproved + 1;
		END;

-- +goose StatementEnd

-- +goose Down

DROP TABLE review;
DROP TABLE stat;
DROP TABLE activity;
DROP TRIGGER activity_trigger_after_insert_correct_review;
DROP TRIGGER activity_trigger_after_insert_incorrect_review;
DROP TRIGGER activity_trigger_after_update_forgotten_review;
DROP TRIGGER activity_trigger_after_update_unimproved_review;
DROP TRIGGER activity_trigger_after_update_crammed_review;
DROP TRIGGER activity_trigger_after_update_learned_review;
DROP TRIGGER activity_trigger_after_update_strengthened_review;
DROP TRIGGER activity_trigger_after_delete_correct_review;
DROP TRIGGER activity_trigger_after_delete_incorrect_review;
