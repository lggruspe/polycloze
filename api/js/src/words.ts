// Word scheduler.

import { ReadOnly, Store } from "./db";
import { isTooEasy, isTooHard } from "./wilson";

// Returns smallest frequency class among unseen words.
async function easiestUnseen(
    store: Store<"unseen-words", ReadOnly>,
): Promise<number> {
    const index = store.index("frequency-class");
    const cursor = await index.openCursor(undefined, "nextunique");
    if (cursor) {
        return cursor.value.frequencyClass;
    }
    return 0;
}

// Determines appropriate frequency class for student.
export async function placement(
    difficultyStats: Store<"difficulty-stats", ReadOnly>,
    unseenWords: Store<"unseen-words", ReadOnly>,
): Promise<number> {
    let level = await easiestUnseen(unseenWords);
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

// Returns words that are >= preferred difficulty.
// `limit`: max number of words to return.
export async function * hardWords(
    store: Store<"unseen-words", ReadOnly>,
    difficulty: number,
    limit: number,
): AsyncGenerator<string> {
    const range = IDBKeyRange.lowerBound(difficulty);

    const index = store.index("frequency-class");
    let cursor = await index.openCursor(range, "next");

    while (limit-- > 0 && cursor) {
        yield cursor.value.word;
        cursor = await cursor.continue();
    }
}

// Returns words that are < preferred difficulty.
// `limit`: max number of words to return.
export async function * easyWords(
    store: Store<"unseen-words", ReadOnly>,
    difficulty: number,
    limit: number,
): AsyncGenerator<string> {
    const range = IDBKeyRange.upperBound(difficulty, true);

    const index = store.index("frequency-class");
    let cursor = await index.openCursor(range, "prev");

    while (limit-- > 0 && cursor) {
        yield cursor.value.word;
        cursor = await cursor.continue();
    }
}
