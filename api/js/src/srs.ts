// Word + review scheduler.

import { fetchWordList, syncReviews } from "./api";
import {
    Database,
    DifficultyStatsValue,
    IntervalStatsValue,
    ReadOnly,
    ReadWrite,
    ReviewsValue,
    Schema,
    Store,
    StoreName,
} from "./db";
import { isTooEasy, isTooHard } from "./wilson";
import { easyWords, hardWords, placement } from "./words";

import {
    openDB,
    IDBPCursorWithValue,
} from "idb";

// Upgrades indexed db to the new version.
function upgrade(db: Database, oldVersion: number) {
    if (oldVersion < 1) {
        db.createObjectStore("data-version", {
            keyPath: "name",
        });

        db.createObjectStore("sequence-numbers", {
            keyPath: "name",
        });

        const wordList = db.createObjectStore("word-list", {
            keyPath: "word",
        });
        wordList.createIndex(
            "seen,frequency-class",
            ["seen", "frequencyClass"],
            {
                multiEntry: false,
                unique: false,
            },
        );

        const unacknowledgedReviews = db.createObjectStore("unacknowledged-reviews", {
            keyPath: "word",
        });
        unacknowledgedReviews.createIndex("reviewed", "reviewed", {
            unique: false,
        });

        const acknowledgedReviews = db.createObjectStore("acknowledged-reviews", {
            keyPath: "word",
        });
        acknowledgedReviews.createIndex("due", "due", { unique: false });
        acknowledgedReviews.createIndex("sequence-number", "sequenceNumber", {
            unique: true,
        });

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

export function openSRS(l1: string, l2: string): Promise<Database> {
    return openDB<Schema>(`${l1}-${l2}`, undefined, {
        upgrade,
    });
}

// Returns words that are due for a review.
export async function schedule(
    db: Database,
    limit = 10,
    exclude: Set<string> = new Set(),
): Promise<string[]> {
    const range = IDBKeyRange.upperBound(new Date());

    const storeNames: StoreName[] = [
        "acknowledged-reviews",
        "difficulty-stats",
        "word-list",
    ];
    const tx = db.transaction(storeNames, "readonly");
    const acknowledgedReviews = tx.objectStore("acknowledged-reviews");
    const index = acknowledgedReviews.index("due");

    const reviews = [];
    let cursor = await index.openCursor(range);
    while (cursor && reviews.length < limit) {
        const word = cursor.value.word;
        if (!exclude.has(word)) {
            reviews.push(word);
        }
        cursor = await cursor.continue();
    }

    // If limit has been reached, return.
    if (reviews.length >= limit) {
        return reviews;
    }

    // FIXME schedule keeps returning the same set of words, because
    // word-list never gets updated.
    const difficultyStats = tx.objectStore("difficulty-stats");
    const wordList = tx.objectStore("word-list");
    const level = await placement(difficultyStats, wordList);
    reviews.push(...await hardWords(wordList, level, limit - reviews.length));

    if (reviews.length >= limit) {
        return reviews;
    }
    reviews.push(...await easyWords(wordList, level, limit - reviews.length));
    return reviews;
}

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
    intervalStats: Store<"interval-stats", ReadOnly>,
    sequenceNumbers: Store<"sequence-numbers", ReadWrite>,
    word: string,
    previous: ReviewsValue | undefined,
    correct: boolean,
): Promise<ReviewsValue> {
    const hour = 1000 * 60 * 60;
    const now = new Date();

    // sequence numbers should be generated in the last possible moment to
    // avoid race conditions (e.g. when you generate a sequence number before
    // an await call).
    if (previous == null) {
        const interval = correct ? 24 : 0;
        return {
            word,
            learned: now,
            reviewed: now,
            interval,
            due: new Date(now.getTime() + interval * hour),
            sequenceNumber: await getSequenceNumber(sequenceNumbers),
        };
    }

    if (!correct) {
        return {
            word,
            learned: previous.learned,
            reviewed: now,
            interval: 0,
            due: now,
            sequenceNumber: await getSequenceNumber(sequenceNumbers),
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
            sequenceNumber: await getSequenceNumber(sequenceNumbers),
        };
    }

    const delta = now.getTime() - previous.reviewed.getTime();
    const interval = await nextInterval(intervalStats, delta / hour, true) as IntervalStatsValue;
    return {
        word,
        learned: previous.learned,
        reviewed: now,
        interval: interval.interval,
        due: new Date(now.getTime() + interval.interval * hour),
        sequenceNumber: await getSequenceNumber(sequenceNumbers),
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

// Increments current sequence number and returns the result.
async function getSequenceNumber(store: Store<"sequence-numbers", ReadWrite>): Promise<number> {
    const value = await store.get("sequence-number");
    let seqnum = value?.value || 0;
    seqnum++;
    store.put({ name: "sequence-number", value: seqnum });
    return seqnum;
}

// Sets the current sequence number to `sequenceNumber` if it's larger.
// Returns the new current sequence number.
async function setSequenceNumber(
    store: Store<"sequence-numbers", ReadWrite>,
    sequenceNumber: number,
): Promise<number> {
    const value = await store.get("sequence-number");
    const current = value?.value || 0;
    if (sequenceNumber <= current) {
        return current;
    }
    store.put({ name: "sequence-number", value: sequenceNumber });
    return sequenceNumber;
}

export async function saveReview(
    db: Database,
    word: string,
    correct: boolean,
    now: Date = new Date(),
): Promise<void> {
    const tx = db.transaction(db.objectStoreNames, "readwrite");
    const acknowledgedReviews = tx.objectStore("acknowledged-reviews");

    // Doesn't include reviews from `unacknowledged-reviews` store for simplicity.
    const previous = await acknowledgedReviews.get(word);
    if (previous == null || previous.due <= now) {
        // Update interval stats if word is new or if the student didn't cram.
        const store = tx.objectStore("interval-stats");
        await updateIntervalStats(store, previous?.interval || 0, correct);
    }

    const intervalStats = tx.objectStore("interval-stats");
    const sequenceNumbers = tx.objectStore("sequence-numbers");
    const review = await nextReview(intervalStats, sequenceNumbers, word, previous, correct);
    const unacknowledgedReviews = tx.objectStore("unacknowledged-reviews");
    unacknowledgedReviews.put(review);

    autoTune(intervalStats, previous?.interval || 0);
    return await tx.done;
}

// Gets all unacknowledged reviews from the database.
async function getAllUnacknowledgedReviews(
    store: Store<"unacknowledged-reviews", ReadOnly>,
): Promise<ReviewsValue[]> {
    const reviews = [];
    const index = store.index("reviewed");

    let cursor = await index.openCursor();
    while (cursor) {
        reviews.push(cursor.value);
        cursor = await cursor.continue();
    }
    return reviews;
}

// Gets all difficulty stats as string.
async function getDifficultyStatsJSON(
    store: Store<"difficulty-stats", ReadOnly>,
): Promise<string> {
    const stats = [];
    let cursor = await store.openCursor();
    while (cursor) {
        stats.push(cursor.value);
        cursor = await cursor.continue();
    }
    return JSON.stringify(stats);
}

// Gets all interval stats as string.
async function getIntervalStatsJSON(
    store: Store<"interval-stats", ReadOnly>,
): Promise<string> {
    const stats = [];
    let cursor = await store.openCursor();
    while (cursor) {
        stats.push(cursor.value);
        cursor = await cursor.continue();
    }
    return JSON.stringify(stats);
}

// Returns the latest acknowledged review, or `undefined`.
async function latestAcknowledgedReview(
    store: Store<"acknowledged-reviews", ReadOnly>
): Promise<ReviewsValue | undefined> {
    const index = store.index("sequence-number");

    const cursor = await index.openCursor(undefined, "prevunique");
    if (cursor) {
        return cursor.value;
    }
    return undefined;
}

// Prepares data to push to the server.
async function prepareUnpushedData(db: Database) {
    // Takes a DB to prevent the caller from fetching within the same
    // transaction.
    const storeNames: StoreName[] = [
        "acknowledged-reviews",
        "unacknowledged-reviews",
        "difficulty-stats",
        "interval-stats",
    ];
    const tx = db.transaction(storeNames, "readonly");
    const acknowledgedReviews = tx.objectStore("acknowledged-reviews");
    const unacknowledgedReviews = tx.objectStore("unacknowledged-reviews");
    const difficultyStats = tx.objectStore("difficulty-stats");
    const intervalStats = tx.objectStore("interval-stats");

    const latest = await latestAcknowledgedReview(acknowledgedReviews);
    return {
        "latest": latest?.sequenceNumber || 0,
        "reviews": await getAllUnacknowledgedReviews(unacknowledgedReviews),
        "difficultyStats": await getDifficultyStatsJSON(difficultyStats),
        "intervalStats": await getIntervalStatsJSON(intervalStats),
    };
}

// Syncs local DB with remote DB.
export async function sync(db: Database): Promise<void> {
    await fetchWordList(db);

    // Push unpushed changes.
    const resp = await syncReviews(await prepareUnpushedData(db));
    // TODO empty response means no conflict
    // TODO but what if client synced without pushing anything?

    const tx = db.transaction(db.objectStoreNames, "readwrite");
    const acknowledgedReviews = tx.objectStore("acknowledged-reviews");
    const unacknowledgedReviews = tx.objectStore("unacknowledged-reviews");
    const reviews = resp.reviews || [];
    if (reviews.length === 0) {
        // ACK un-ACK'ed reviews if there are no conflicts.
        acknowledgeReviews(acknowledgedReviews, unacknowledgedReviews);
        return await tx.done;
    }

    // Resolve conflicts.
    const difficultyStatsJSON = resp?.difficultyStats || "";
    const intervalStatsJSON = resp?.intervalStats || "";
    // TODO incorrect assertion because server might not have a copy yet?
    console.assert(difficultyStatsJSON.length > 0);
    console.assert(intervalStatsJSON.length > 0);

    // Acknowledge new reviews from the server.
    const hour = 1000 * 60 * 60;
    let latest = 0;
    for (const review of reviews) {
        const reviewed = new Date(review.reviewed);
        const { interval, sequenceNumber } = review;
        acknowledgedReviews.put({
            word: review.word,
            learned: new Date(review.learned),
            reviewed,
            interval,
            due: new Date(reviewed.getTime() + interval * hour),
            sequenceNumber,
        });

        if (sequenceNumber > latest) {
            latest = sequenceNumber;
        }
    }

    const sequenceNumbers = tx.objectStore("sequence-numbers");
    const difficultyStats = tx.objectStore("difficulty-stats");
    const intervalStats = tx.objectStore("interval-stats");
    // TODO be mindful of transaction lifetimes
    await Promise.all([
        setSequenceNumber(sequenceNumbers, latest),
        unacknowledgedReviews.clear(),
        replaceDifficultyStats(difficultyStats, difficultyStatsJSON),
        replaceIntervalStats(intervalStats, intervalStatsJSON),
    ]);
    return await tx.done;
}

// Replaces difficulty stats with stats received from server.
async function replaceDifficultyStats(
    store: Store<"difficulty-stats", ReadWrite>,
    json: string,
) {
    await store.clear();
    const stats = JSON.parse(json) as DifficultyStatsValue[];
    for (const stat of stats) {
        store.put(stat);
    }
}

// Replaces interval stats with stats received from server.
async function replaceIntervalStats(
    store: Store<"interval-stats", ReadWrite>,
    json: string,
) {
    await store.clear();
    const stats = JSON.parse(json) as IntervalStatsValue[];
    for (const stat of stats) {
        store.put(stat);
    }
}

// Moves all reviews from "unacknowledged-reviews" store to "acknowledged-reviews".
async function acknowledgeReviews(
    acknowledgedReviews: Store<"acknowledged-reviews", ReadWrite>,
    unacknowledgedReviews: Store<"unacknowledged-reviews", ReadWrite>,
) {
    let cursor = await unacknowledgedReviews.openCursor();
    while (cursor) {
        acknowledgedReviews.put(cursor.value);
        cursor = await cursor.continue();
    }
    await unacknowledgedReviews.clear();
}
