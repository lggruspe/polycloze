// Indexed DB schema definition.

import {
    DBSchema,
    IDBPDatabase,
    IDBPObjectStore,
} from "idb";

// Used in indexedDB schema only (JSON API schema uses a different schema).
export type ReviewsValue = {
    word: string;       // key
    learned: Date;      // default now
    reviewed: Date;     // default now
    interval: number;   // default 0 or 24 hours
    due: Date;          // reviewed + interval (in seconds)
    sequenceNumber: number;
};

export type DifficultyStatsValue = {
    difficulty: number; // key
    correct: number;    // default 0
    incorrect: number;  // default 0
};

export type IntervalStatsValue = {
    interval: number;   // key (in hours)
    correct: number;    // default 0
    incorrect: number;  // default 0
};

type Word = {
    word: string;   // key
    frequencyClass: number;
};

export interface Schema extends DBSchema {
    "data-version": {
        key: "etag"; // Literal
        value: {
            name: "etag";
            etag: string;
        };
    }

    "seen-words": {
        key: string;
        value: Word;
    }

    "unseen-words": {
        key: string;
        value: Word;
        indexes: { "frequency-class": number };
    }

    "sequence-numbers": {
        key: "sequence-number"; // Literal
        value: {
            name: "sequence-number";
            value: number;
        };
    };

    "unacknowledged-reviews": {
        key: string;
        value: ReviewsValue;
        indexes: { reviewed: Date };
    };

    "acknowledged-reviews": {
        key: string;
        value: ReviewsValue;
        indexes: { due: Date, "sequence-number": number };
    };

    "difficulty-stats": {
        key: number;
        value: DifficultyStatsValue;
    };

    "interval-stats": {
        key: number;
        value: IntervalStatsValue;
    };
}

export type Database = IDBPDatabase<Schema>;

export type ReadOnly = "readonly" | "readwrite";
export type ReadWrite = "readwrite";
export type TransactionMode = ReadOnly | ReadWrite;

export type StoreName = "data-version" | "seen-words" | "unseen-words" | "sequence-numbers" | "unacknowledged-reviews" | "acknowledged-reviews" | "difficulty-stats" | "interval-stats";

export type Store<T extends StoreName, U extends TransactionMode> = IDBPObjectStore<Schema, ("interval-stats")[], T, U>;
