// JSON schemas used by server.

import { Item } from "./item";

export type ItemsSchema = {
    items: Item[];
};

export type ReviewSchema = {
    success: boolean;
    frequencyClass: number;    // describes student's level
};

export type Language = {
  code: string;
  name: string;
  bcp47: string;
};

export type LanguagesSchema = {
  languages: Language[];
};

export type Course = {
    l1: Language;
    l2: Language;
};

export type CoursesSchema = {
    courses: Course[];
};

export type Word = {
  word: string;
  learned: string;
  reviewed: string;
  due: string;
  strength: number;
};

// from /<l1>/<l2>/vocab
export type VocabularySchema = {
  words: Word[];
};

export type Activity = {
  forgotten: number;
  unimproved: number;
  crammed: number;
  learned: number;
  strengthened: number;
};

// from /<l1>/<l2>/activity
export type ActivityHistory = {
  activities: Activity[]; // up to one year of activities
  aggregates: Activity;   // for > 1 year old
};

export type ActivitySummary = {
  from: Date;
  to: Date;

  unimproved: number;
  learned: number;
  forgotten: number;
  crammed: number;
  strengthened: number;
};

// from /api/stats/activity/<l1>/<l2>?from=<from>&to=<to>&step=<step>
export type ActivitySchema = {
  activity: ActivitySummary[];
};

// Not to be confused with sentence.Sentence.
export type RandomSentence = {
  id: number;
  tatoebaID?: number;
  text: string;
};

export type RandomSentencesSchema = {
  "sentences": RandomSentence[];
}

export type DataPoint = {
  time: Date;
  value: number;
};

// from /api/stats/vocab/<l1>/<l2>?from=<from>&to=<to>&step=<step>
export type VocabularySizeSchema = {
  vocabSize: DataPoint[];
};
