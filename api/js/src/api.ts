// Wrappers for api calls.

import { parseCSV } from "./csv";
import { Database, StoreName } from "./db";
import { Item } from "./item";
import { getL1, getL2 } from "./language";
import { fetchJson, resolve, submitJson } from "./request";
import {
    ActivitySchema,
    ActivitySummary,
    Course,
    CoursesSchema,
    DataPoint,
    ItemsSchema,
    Language,
    LanguagesSchema,
    RandomSentence,
    RandomSentencesSchema,
    ReviewSchema,
    SyncRequestSchema,
    SyncResponseSchema,
    Word,
    VocabularySchema,
    VocabularySizeSchema,
} from "./schema";

type FetchVocabularyOptions = {
    // Path params
    l1?: string;    // L1 code
    l2?: string;    // L2 code

    // Search params
    limit?: number;  // Max number of items to fetch
    after?: string;  // Last item to exclude from query
    sortBy?: "word" | "reviewed" | "due" | "strength";
};

function defaultFetchVocabularyOptions(): FetchVocabularyOptions {
    return {
        l1: getL1().code,
        l2: getL2().code,
        limit: 50,
        after: "",
        sortBy: "word",
    };
}

export async function fetchVocabulary(options: FetchVocabularyOptions = {}): Promise<Word[]> {
    const { l1, l2, limit, after, sortBy } = {...defaultFetchVocabularyOptions(), ...options};
    const url = resolve(`/${l1}/${l2}/vocab`);
    setParams(url, { after, limit, sortBy });

    const json = await fetchJson<VocabularySchema>(url, {
        mode: "cors" as RequestMode,
    });
    return json.words || [];
}

type FetchActivityOptions = {
    l1?: string;
    l2?: string;
    from?: Date;
    to?: Date;
    step?: number;
};

function defaultFetchActivityOptions(): FetchActivityOptions {
    return {
        l1: getL1().code,
        l2: getL2().code,
        // TODO from and to
        step: 86400,    // 1 day
    };
}

// Fetches student's recent activity.
export async function fetchActivity(options: FetchActivityOptions = {}): Promise<ActivitySummary[]> {
    const {l1, l2} = {...defaultFetchActivityOptions(), ...options};
    const url = resolve(`/api/stats/activity/${l1}/${l2}`);
    setParams(url, {
        from: options.from ? options.from.getTime() / 1000 : undefined,
        to: options.to ? options.to.getTime() / 1000 : undefined,
        step: options.step || undefined,
    });
    const json = await fetchJson<ActivitySchema>(url, {
        mode: "cors" as RequestMode,
    });
    return json.activity.map(s => {
        return {
            ...s,
            from: new Date(s.from),
            to: new Date(s.to),
        };
    });
}

type FetchVocabularySizeOptions = {
    l1?: string;
    l2?: string;
    from?: Date;
    to?: Date;
    step?: number;
};

function defaultFetchVocabularySizeOptions(): FetchVocabularySizeOptions {
    return {
        l1: getL1().code,
        l2: getL2().code,
        // TODO from and to
        step: 86400,    // 1 day
    };
}

// Fetches student's vocab size over time.
export async function fetchVocabularySize(options: FetchVocabularySizeOptions = {}): Promise<DataPoint[]> {
    const {l1, l2} = {...defaultFetchVocabularySizeOptions(), ...options};
    const url = resolve(`/api/stats/vocab/${l1}/${l2}`);
    setParams(url, {
        from: options.from ? options.from.getTime() / 1000 : undefined,
        to: options.to ? options.to.getTime() / 1000 : undefined,
        step: options.step || undefined,
    });
    const json = await fetchJson<VocabularySizeSchema>(url, {
        mode: "cors" as RequestMode,
    });
    return json.vocabSize.map(p => {
        return {
            time: new Date(p.time),
            value: p.value,
        };
    });
}

export async function fetchCourses(): Promise<Course[]> {
    const url = resolve("/api/courses");
    setParams(url, { t: "20221114" });
    const json = await fetchJson<CoursesSchema>(url, {
        mode: "cors" as RequestMode,
    });
    return json.courses;
}

// Fetches list of supported languages (L1).
export async function fetchLanguages(): Promise<Language[]> {
    const url = resolve("/api/languages");
    setParams(url, { t: "20221114" });
    const json = await fetchJson<LanguagesSchema>(url, {
        mode: "cors" as RequestMode,
    });
    return json.languages;
}

type FetchItemsOptions = {
    // Path params
    l1?: string;    // L1 code
    l2?: string;    // L2 code

    // Search params
    n?: number;      // Max number of items to fetch
    x?: string[];    // Words to exclude
};

function defaultFetchItemsOptions(): FetchItemsOptions {
    return {
        l1: getL1().code,
        l2: getL2().code,
        n: 10,
        x: [],
    };
}

export async function fetchItems(options: FetchItemsOptions = {}): Promise<Item[]> {
    const { l1, l2, n, x } = {...defaultFetchItemsOptions(), ...options};
    const url = resolve(`/${l1}/${l2}`);
    setParams(url, { n, x });

    const json = await fetchJson<ItemsSchema>(url, {
        mode: "cors" as RequestMode,
    });
    return json.items;
}

export async function experimentalFetchItems(
    words: string[],
    options: FetchItemsOptions = {},
): Promise<Item[]> {
    const { l1, l2 } = {...defaultFetchItemsOptions(), ...options};
    const url = resolve(`/api/test/${l1}/${l2}`);
    const json = await submitJson<ItemsSchema>(url, { words });
    return json.items;
}

type FetchSentencesOptions = {
    l1?: string;
    l2?: string;
    limit?: number;
};

function defaultFetchSentencesOptions(): FetchSentencesOptions {
    return {
        l1: getL1().code,
        l2: getL2().code,
        limit: 1,
    };
}

export async function fetchSentences(options: FetchSentencesOptions = {}): Promise<RandomSentence[]> {
    const { l1, l2, limit } = {...defaultFetchSentencesOptions(), ...options};
    if (l1 == null || l2 == null) {
        throw new Error("l1 and l2 required");
    }

    const url = resolve("/api/sentences");
    setParams(url, {l1, l2, limit});

    const json = await fetchJson<RandomSentencesSchema>(url, {
        mode: "cors" as RequestMode,
    });
    return json.sentences;
}

// Gets ETag of current word list.
async function getWordListVersion(db: Database): Promise<string> {
    const tx = db.transaction("data-version", "readonly");
    const store = tx.objectStore("data-version");
    const value = await store.get("etag");
    return value?.etag || "";
}

// Downloads word list into the database.
export async function fetchWordList(db: Database): Promise<void> {
    const l1 = getL1().code;
    const l2 = getL2().code;
    const url = resolve(`/share/words/${l1}-${l2}.csv`);

    const currentETag = await getWordListVersion(db);
    const response = await fetch(url.href, {
        mode: "cors" as RequestMode,
        headers: {
            "If-None-Match": currentETag,
        },
    });
    const etag = response.headers.get("ETag") || "";
    if (etag === currentETag) {
        // Don't have do anything if word list is up-to-date.
        return;
    }

    // Get all words from the CSV. This should probably be okay, because the
    // largest CSV file is only ~2MB big.
    // The idb transaction closes when you do it inside the transaction.
    const records: [string, number][] = [];
    for (const row of parseCSV(await response.text())) {
        if (row.length !== 2) {
            // Invalid record.
            continue;
        }
        const word = row[0];
        const frequencyClass = Number(row[1]);
        if (isNaN(frequencyClass)) {
            // Invalid record.
            continue;
        }
        records.push([word, frequencyClass]);
    }

    const storeNames: StoreName[] = [
        "data-version",
        "acknowledged-reviews",
        "seen-words",
        "unseen-words",
    ];
    const tx = db.transaction(storeNames, "readwrite");
    const dataVersion = tx.objectStore("data-version");
    const acknowledgedReviews = tx.objectStore("acknowledged-reviews");
    const seenWords = tx.objectStore("seen-words");
    const unseenWords = tx.objectStore("unseen-words");

    // Clear word stores first.
    await Promise.all([seenWords.clear(), unseenWords.clear()]);

    const promises = [];
    // TODO is `acknowledgedReviews` up-to-date at this point?
    const seen = new Set(await acknowledgedReviews.getAllKeys());
    for (const [word, frequencyClass] of records) {
        if (seen.has(word)) {
            promises.push(seenWords.add({ word, frequencyClass }));
        } else {
            promises.push(unseenWords.add({ word, frequencyClass }));
        }
    }
    await Promise.all(promises);

    // Update etag value stored in db.
    await dataVersion.put({ name: "etag", etag });
    return await tx.done;
}

type SyncReviewsOptions = {
    l1?: string;
    l2?: string;
};

function defaultSyncReviewsOptions(): SyncReviewsOptions {
    return {
        l1: getL1().code,
        l2: getL2().code,
    };
}

export function syncReviews(
    data: SyncRequestSchema,
    options: SyncReviewsOptions = {},
) {
    const { l1, l2 } = {...defaultSyncReviewsOptions(), ...options};
    if (l1 == null || l2 == null) {
        throw new Error("l1 and l2 required");
    }
    const url = resolve(`/api/sync/${l1}/${l2}`);
    return submitJson<SyncResponseSchema>(url, data);
}

type Params = {
    [name: string]: unknown;
};

function setParams(url: URL, params: Params) {
    for (const name of Object.getOwnPropertyNames(params)) {
        const value = params[name];
        if (value === undefined) {
            continue;
        }
        if (value instanceof Array) {
            for (const item of value) {
                url.searchParams.append(name, item);
            }
            continue;
        }
        url.searchParams.set(name, String(value));
    }
}

export function submitReview(word: string, correct: boolean): Promise<ReviewSchema> {
    const l1 = getL1().code;
    const l2 = getL2().code;

    const url = resolve(`/${l1}/${l2}`);
    const data = {
        reviews: [
            { word, correct },
        ],
    };
    return submitJson<ReviewSchema>(url, data);
}
