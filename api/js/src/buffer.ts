// Item buffer

import { fetchItems } from "./api";
import { PartWithAnswers, hasAnswers } from "./blank";
import { Database } from "./db";
import { Item } from "./item";
import { getL1, getL2 } from "./language";
import { Sentence } from "./sentence";
import { openSRS } from "./srs";

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

        const listener = (event: Event) => {
            const word = (event as CustomEvent).detail.word;
            this.keys.delete(word);
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
            const items = await fetchItems({
                n: count,
                x: Array.from(this.keys),
            });
            items.forEach(item => this.add(item));
        });
    }

    // Returns Promise<Item>.
    // May return undefined if there are no items left for review and there are
    // no new items left.
    async take(): Promise<Item | undefined> {
        if (this.buffer.length === 0) {
            const items = await fetchItems({
                n: 2,
                x: Array.from(this.keys),
            });
            this.backgroundFetch(2);
            items.forEach(item => this.add(item));
            return this.buffer.shift();
        }
        if (this.buffer.length < 10) {
            this.backgroundFetch(10);
        }
        return this.buffer.shift();
    }

    clearIfStale(frequencyClass: number) {
        if (this.frequencyClass != undefined && this.frequencyClass != frequencyClass) {
            // Leaves some items in the buffer so flashcards come continuously.
            this.buffer.splice(3);
        }
        this.frequencyClass = frequencyClass;
    }
}

// Dispatches custom event to tell item buffer about review result.
export function announceResult(word: string, correct: boolean) {
    const event = new CustomEvent("polycloze-review", {
        detail: { word, correct }
    });
    window.dispatchEvent(event);
}
