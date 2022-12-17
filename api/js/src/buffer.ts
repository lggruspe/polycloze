// Item buffer

import { fetchItems, submitReview } from "./api";
import { PartWithAnswers, hasAnswers } from "./blank";
import { Difficulty, DifficultyTuner } from "./difficulty";
import { Item } from "./item";
import { Sentence } from "./sentence";
import { edit } from "./unsaved";

function* getBlankParts(sentence: Sentence): IterableIterator<PartWithAnswers> {
  for (const part of sentence.parts) {
    if (hasAnswers(part)) {
      yield part as PartWithAnswers;
    }
  }
}

export class ItemBuffer {
  buffer: Item[];
  keys: Set<string>;
  difficultyTuner: DifficultyTuner;

  constructor() {
    // TODO pass difficulty arg to DifficultyTuner
    this.difficultyTuner = new DifficultyTuner();
    this.buffer = [];
    this.keys = new Set();

    const listener = async (event: Event) => {
      const { word, correct } = (event as CustomEvent).detail;

      const save = edit();
      await submitReview(word, correct);
      this.keys.delete(word);
      save();

      await this.clearStale(correct);
    };

    // NOTE this never gets removed
    window.addEventListener("polycloze-review", listener);
  }

  // Add item if it's not a duplicate.
  add(item: Item): boolean {
    const parts = Array.from(getBlankParts(item.sentence));

    const words: string[] = [];
    const isDuplicate = parts.some((part) => {
      const word = part.answers[0].normalized;
      words.push(word);
      return this.keys.has(word);
    });
    if (isDuplicate) {
      return false;
    }
    this.buffer.push(item);
    words.forEach((word) => this.keys.add(word));
    return true;
  }

  backgroundFetch(count: number) {
    setTimeout(async () => {
      const items = await fetchItems({
        n: count,
        x: Array.from(this.keys),
      });
      items.forEach((item) => this.add(item));
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
      items.forEach((item) => this.add(item));
      return this.buffer.shift();
    }
    if (this.buffer.length < 10) {
      this.backgroundFetch(10);
    }
    return this.buffer.shift();
  }

  // Removes stale flashcards (e.g. when placement level changes).
  // `correct`: whether or not most recently reviewed card was answered
  // correctly.
  async clearStale(correct: boolean) {
    const changed = this.difficultyTuner.update(correct);
    // TODO trigger refetch of items on change
    if (changed) {
      // Leaves some items in the buffer so flashcards come continuously.
      // TODO reduce number of items to keep in the buffer.
      this.buffer.splice(3);
    }
  }
}

// Dispatches custom event to tell item buffer about review result.
export function announceResult(word: string, correct: boolean) {
  const event = new CustomEvent("polycloze-review", {
    detail: { word, correct },
  });
  window.dispatchEvent(event);
}
