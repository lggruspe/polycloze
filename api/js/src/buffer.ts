// Item buffer

import { PartWithAnswers, hasAnswers } from "./blank";
import { experimentalFetchItems } from "./api";
import { Database, StoreName } from "./db";
import { Item } from "./item";
import { getL1, getL2 } from "./language";
import { Sentence } from "./sentence";
import { openSRS, saveReview, schedule, sync } from "./srs";
import { edit } from "./unsaved";
import { placement } from "./words";

function * getBlankParts(sentence: Sentence): IterableIterator<PartWithAnswers> {
    for (const part of sentence.parts) {
        if (hasAnswers(part)) {
            yield part as PartWithAnswers;
        }
    }
}

export class ItemBuffer {
    buffer: Item[];
    keys: Set<string>;
    dbPromise: Promise<Database>;

    frequencyClass?: number;

    constructor() {
        this.buffer = [];
        this.keys = new Set();
        this.dbPromise = openSRS(getL1().code, getL2().code);

        const listener = async(event: Event) => {
            const { word, correct } = (event as CustomEvent).detail;
            const db = await this.dbPromise;

            const save = edit();
            await saveReview(db, word, correct);
            this.keys.delete(word);
            save();

            await this.clearStale();
        };

        // NOTE this never gets removed
        window.addEventListener("polycloze-review", listener);
    }

    // Add item if it's not a duplicate.
    add(item: Item): boolean {
        const parts = Array.from(getBlankParts(item.sentence));

        const words: string[] = [];
        const isDuplicate = parts.some(part => {
            const word = part.answers[0].normalized;
            words.push(word);
            return this.keys.has(word);
        });
        if (isDuplicate) {
            return false;
        }
        this.buffer.push(item);
        words.forEach(word => this.keys.add(word));
        return true;
    }

    backgroundFetch(count: number) {
        setTimeout(async() => {
            const db = await this.dbPromise;
            await sync(db);

            const words = await schedule(db, count, this.keys);
            const items = await experimentalFetchItems(words);
            items.forEach(item => this.add(item));
        });
    }

    // Returns Promise<Item>.
    // May return undefined if there are no items left for review and there are
    // no new items left.
    async take(): Promise<Item | undefined> {
        if (this.buffer.length === 0) {
            const db = await this.dbPromise;
            await sync(db);

            const words = await schedule(db, 2, this.keys);
            const items = await experimentalFetchItems(words);

            this.backgroundFetch(2);

            items.forEach(item => this.add(item));
            return this.buffer.shift();
        }
        if (this.buffer.length < 10) {
            this.backgroundFetch(10);
        }
        return this.buffer.shift();
    }

    // Removes stale flashcards if placement level changed.
    async clearStale() {
        // Compute placement level.
        const storeNames: StoreName[] = ["difficulty-stats", "word-list"];

        const db = await this.dbPromise;
        const tx = db.transaction(storeNames, "readonly");
        const difficultyStats = tx.objectStore("difficulty-stats");
        const wordList = tx.objectStore("word-list");
        const level = await placement(difficultyStats, wordList);

        if (this.frequencyClass != undefined && this.frequencyClass != level) {
            // Leaves some items in the buffer so flashcards come continuously.
            // The time it takes to review the items left in the buffer should
            // be > time it takes to fetch the next batch of flashcards.
            this.buffer.splice(2);
        }
        this.frequencyClass = level;
    }
}

// Dispatches custom event to tell item buffer about review result.
export function announceResult(word: string, correct: boolean) {
    const event = new CustomEvent("polycloze-review", {
        detail: { word, correct },
    });
    window.dispatchEvent(event);
}
