// Word scheduler.

import { ReadOnly, Store } from "./db";
import { isTooEasy, isTooHard } from "./wilson";

// Returns smallest frequency class among unseen words.
async function easiestUnseen(
    store: Store<"word-list", ReadOnly>,
): Promise<number> {
    const range = IDBKeyRange.upperBound([1, 0], true);
    const index = store.index("seen,frequency-class");
    const cursor = await index.openCursor(range, "next");
    if (cursor) {
        return cursor.value.frequencyClass;
    }
    return 0;
}

// Determines appropriate frequency class for student.
export async function placement(
    difficultyStats: Store<"difficulty-stats", ReadOnly>,
    wordList: Store<"word-list", ReadOnly>,
): Promise<number> {
    let level = await easiestUnseen(wordList);
    let lastCorrect = 0;
    let lastIncorrect = 0;

    let cursor = await difficultyStats.openCursor(undefined, "nextunique");
    while (cursor) {
        const { difficulty, correct, incorrect } = cursor.value;
        if (isTooHard(correct, incorrect)) {
            return level;
        }

        level = difficulty;
        if (!isTooEasy(correct, incorrect)) {
            return level;
        }

        cursor = await cursor.continue();
        lastCorrect = correct;
        lastIncorrect = incorrect;
    }

    if (isTooEasy(lastCorrect, lastIncorrect)) {
        level++;
    }
    return level;
}

// Returns unseen words that are >= preferred difficulty.
// `limit`: max number of words to return.
// `exclude`: words to exclude.
export async function hardWords(
    store: Store<"word-list", ReadOnly>,
    difficulty: number,
    limit: number,
    exclude: Set<string> = new Set(),
): Promise<string[]> {
    const range = IDBKeyRange.bound(
        [0, difficulty],
        [1, 0],
        false,
        true,
    );

    const index = store.index("seen,frequency-class");
    let cursor = await index.openCursor(range, "next");

    const words = [];
    while (limit-- > 0 && cursor) {
        const word = cursor.value.word;
        if (!exclude.has(word)) {
            words.push(word);
        }
        cursor = await cursor.continue();
    }
    return words;
}

// Returns unseen words that are < preferred difficulty.
// `limit`: max number of words to return.
// `exclude`: words to exclude.
export async function easyWords(
    store: Store<"word-list", ReadOnly>,
    difficulty: number,
    limit: number,
    exclude: Set<string> = new Set(),
): Promise<string[]> {
    const range = IDBKeyRange.upperBound([0, difficulty], true);

    const index = store.index("seen,frequency-class");
    let cursor = await index.openCursor(range, "prev");

    const words = [];
    while (limit-- > 0 && cursor) {
        const word = cursor.value.word;
        if (!exclude.has(word)) {
            words.push(word);
        }
        cursor = await cursor.continue();
    }
    return words;
}
