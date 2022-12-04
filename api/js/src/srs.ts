// Word + review scheduler.

import { isTooEasy, isTooHard } from "./wilson";
import {
    openDB,
    DBSchema,
    IDBPCursorWithValue,
    IDBPDatabase,
    IDBPObjectStore,
} from "idb";

type ReadOnly = "readonly" | "readwrite";
type ReadWrite = "readwrite";
type TransactionMode = ReadOnly | ReadWrite;

type ReviewsValue = {
    word: string;       // key
    learned: Date;      // default now
    reviewed: Date;     // default now
    interval: number;   // default 0 or 24 hours
    due: Date;          // reviewed + interval (in seconds)
};

type IntervalStatsValue = {
    interval: number;   // key (in hours)
    correct: number;    // default 0
    incorrect: number;  // default 0
};

interface Schema extends DBSchema {
    "pending-reviews": {
        key: string;
        value: ReviewsValue;
    };

    "submitted-reviews": {
        key: string;
        value: ReviewsValue;
        indexes: { due: Date };
    };

    "difficulty-stats": {
        key: number;
        value: {
            difficulty: number; // key
            correct: number;    // default 0
            incorrect: number;  // default 0
        };
    };

    "interval-stats": {
        key: number;
        value: IntervalStatsValue;
    };
}

type Database = IDBPDatabase<Schema>;

// Upgrades indexed db to the new version.
function upgrade(db: Database, oldVersion: number) {
    if (oldVersion < 1) {
        db.createObjectStore("pending-reviews", {
            keyPath: "word",
        });

        const submittedReviews = db.createObjectStore("submitted-reviews", {
            keyPath: "word",
        });
        submittedReviews.createIndex("due", "due", { unique: false });

        db.createObjectStore("difficulty-stats", {
            keyPath: "difficulty",
        });
        const intervalStats = db.createObjectStore("interval-stats", {
            keyPath: "interval",
        });

        // Prepopulate interval stats.
        intervalStats.add({
            interval: 0,
            correct: 0,
            incorrect: 0,
        });
        for (let i = 0; i < 16; i++) {
            intervalStats.add({
                interval: 24 * 2**i,
                correct: 0,
                incorrect: 0,
            });
        }
    }
}

export function openSRS() {
    return openDB<Schema>("eng-spa", undefined, {
        upgrade,
    });
}

// Returns words that are due for a review.
export async function schedule(db: Database, limit = 10): Promise<string[]> {
    const range = IDBKeyRange.upperBound(new Date());

    const tx = db.transaction("submitted-reviews", "readonly");
    const store = tx.objectStore("submitted-reviews");
    const index = store.index("due");

    const reviews = [];
    let cursor = await index.openCursor(range);
    while (cursor && reviews.length < limit) {
        // TODO exclude buffered words
        reviews.push(cursor.value.word);
        cursor = await cursor.continue();
    }
    return reviews;
}

type StoreName = "pending-reviews" | "submitted-reviews" | "difficulty-stats" | "interval-stats";

type Store<T extends StoreName, U extends TransactionMode> = IDBPObjectStore<Schema, ("interval-stats")[], T, U>;

// Updates interval stats.
async function updateIntervalStats(store: Store<"interval-stats", ReadWrite>, interval: number, correct: boolean) {
    const value = await store.get(interval);
    if (!value) {
        return;
    }
    if (correct) {
        value.correct++;
    } else {
        value.incorrect++;
    }
    return await store.put(value);
}

// Returns next largest interval.
async function nextInterval(
    store: Store<"interval-stats", ReadOnly>,
    interval: number,
    require: boolean,
): Promise<IntervalStatsValue | undefined> {
    let cursor = await store.openCursor(
        IDBKeyRange.lowerBound(interval, true),
        "nextunique",
    );
    if (cursor) {
        return cursor.value;
    }
    if (!require) {
        return undefined;
    }
    cursor = await store.openCursor(
        IDBKeyRange.lowerBound(interval, false),
        "prevunique",
    ) as IDBPCursorWithValue<Schema, "interval-stats"[], "interval-stats", unknown, ReadOnly>;
    return cursor.value;
}

async function nextReview(
    store: Store<"interval-stats", ReadOnly>,
    word: string, previous: ReviewsValue | undefined,
    correct: boolean,
): Promise<ReviewsValue> {
    const hour = 1000 * 60 * 60;
    const now = new Date();

    if (previous == null) {
        const interval = correct ? 24 : 0;
        return {
            word,
            learned: now,
            reviewed: now,
            interval,
            due: new Date(now.getTime() + interval * hour),
        };
    }

    if (!correct) {
        return {
            word,
            learned: previous.learned,
            reviewed: now,
            interval: 0,
            due: now,
        };
    }

    // If student crammed.
    if (now < previous.due) {
        return {
            word,
            learned: previous.learned,
            reviewed: now,
            interval: previous.interval,
            due: new Date(now.getTime() + previous.interval * hour),
        };
    }

    const delta = now.getTime() - previous.reviewed.getTime();
    const interval = await nextInterval(store, delta / hour, true) as IntervalStatsValue;
    return {
        word,
        learned: previous.learned,
        reviewed: now,
        interval: interval.interval,
        due: new Date(now.getTime() + interval.interval * hour),
    };
}

function lengthenInterval(store: Store<"interval-stats", ReadWrite>, interval: IntervalStatsValue, nextInterval?: IntervalStatsValue) {
    if (!nextInterval) {
        // Capped at max interval.
        return;
    }

    const mid = Math.floor((interval.interval + nextInterval.interval) / 2);
    if (mid === interval.interval) {
        return;
    }

    // NOTE doesn't update review intervals
    if (mid !== nextInterval.interval) {
        store.add({
            interval: mid,
            correct: 0,
            incorrect: 0,
        });
    }
    store.delete(interval.interval);
}

function shortenInterval(store: Store<"interval-stats", ReadWrite>, interval: IntervalStatsValue, prevInterval?: IntervalStatsValue) {
    if (!prevInterval) {
        console.assert(false, "This shouldn't be reachable.");
        return;
    }

    const mid = Math.floor((interval.interval + prevInterval.interval) / 2);
    if (mid === interval.interval) {
        return;
    }

    // NOTE doesn't update review intervals
    if (mid !== prevInterval.interval) {
        store.add({
            interval: mid,
            correct: 0,
            incorrect: 0,
        });
    }
    store.delete(interval.interval);
}

async function previousInterval(
    store: Store<"interval-stats", ReadOnly>,
    interval: number,
    require: boolean,
): Promise<IntervalStatsValue | undefined> {
    let cursor = await store.openCursor(
        IDBKeyRange.upperBound(interval, true),
        "prevunique",
    );
    if (cursor) {
        return cursor.value;
    }
    if (!require) {
        return undefined;
    }
    cursor = await store.openCursor(
        IDBKeyRange.upperBound(interval, false),
        "nextunique",
    ) as IDBPCursorWithValue<Schema, "interval-stats"[], "interval-stats", unknown, ReadOnly>;
    return cursor.value;
}

async function autoTune(
    store: Store<"interval-stats", ReadWrite>,
    interval: number,
) {
    if (interval <= 24) {
        return;
    }

    const prevPromise = previousInterval(store, interval, false);
    const nextPromise = nextInterval(store, interval, false);

    const value = await store.get(interval);
    if (value == null) {
        return;
    }

    if (isTooEasy(value.correct, value.incorrect)) {
        lengthenInterval(store, value, await nextPromise);
    } else if (isTooHard(value.correct, value.incorrect)) {
        shortenInterval(store, value, await prevPromise);
    }
}

export async function saveReview(db: Database, word: string, correct: boolean, now: Date = new Date()) {
    const tx = db.transaction(db.objectStoreNames, "readwrite");
    const submittedReviews = tx.objectStore("submitted-reviews");

    // Doesn't include reviews from `pending-reviews` store for simplicity.
    const previous = await submittedReviews.get(word);
    if (previous == null || previous.due <= now) {
        // Update interval stats if word is new or if the student didn't cram.
        const store = tx.objectStore("interval-stats") as Store<"interval-stats", ReadWrite>;
        await updateIntervalStats(store, previous?.interval || 0, correct);
    }

    const intervalStats = tx.objectStore("interval-stats") as Store<"interval-stats", ReadWrite>;
    const review = await nextReview(intervalStats, word, previous, correct);
    const pendingReviews = tx.objectStore("pending-reviews");
    pendingReviews.put(review);

    autoTune(intervalStats, previous?.interval || 0);
    return tx.done;
}
