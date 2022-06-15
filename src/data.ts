// Contains functions for getting data from the server and from localStorage.

import { src } from './config'
import { Item } from './item'
import { Language } from './select'
import { Sentence } from './sentence'

// Local storage stuff

export function getL1 (): string {
  return localStorage.getItem('l1') || 'eng'
}

export function getL2 (): string {
  return localStorage.getItem('l2') || 'spa'
}

function swapL1L2 () {
  const l1 = getL1()
  const l2 = getL2()
  localStorage.setItem('l1', l2)
  localStorage.setItem('l2', l1)
}

// NOTE Swaps L1 and L2 if code = L2.
// This is needed to make sure the language select form is consistent with
// what's in localStorage.
export function setL1 (code: string) {
  if (code !== getL2()) {
    localStorage.setItem('l1', code)
  } else {
    swapL1L2()
  }
}

// NOTE Swaps L1 and L2 if code = L1.
export function setL2 (code: string) {
  if (code !== getL1()) {
    localStorage.setItem('l2', code)
  } else {
    swapL1L2()
  }
}

function currentCourse (n: number = 10): string {
  return `/${getL1()}/${getL2()}?n=${n}`
}

// Server stuff

async function fetchJson (url: string, options: any): Promise<any> {
  const request = new Request(url, options)
  const response = await fetch(request)
  return await response.json()
}

export async function supportedLanguages (): Promise<Language[]> {
  const url = new URL('/options', src)
  const options = { mode: 'cors' }
  const json = await fetchJson(url, options)
  return json.languages
}

export async function fetchItems (n: number = 10): Promise<Item[]> {
  const url = new URL(currentCourse(n), src)
  const options = { mode: 'cors' }
  const json = await fetchJson(url, options)
  return json.items
}

function * oddParts (sentence: Sentence): IterableIterator<string> {
  for (const [i, part] of sentence.parts.entries()) {
    if (i % 2 === 1) {
      yield part
    }
  }
}

// Used by bufferedFetchItems
let _backgroundFetch = null
const _buffer = []
const _present = new Set()

// Same as fetchItems, but buffered.
export async function bufferedFetchItems (): Promise<Item[]> {
  if (_backgroundFetch != null) {
    const items = await _backgroundFetch
    _backgroundFetch = null
    for (const item of items) {
      const parts = Array.from(oddParts(item.sentence))
      // TODO not perfect, because no case-folding
      // also, it may fetch words that are already in memory (createApp)
      if (parts.every(part => !_present.has(part))) {
        _buffer.push(item)
        parts.forEach(part => _present.add(part))
      }
    }
  }
  if (_buffer.length < 20) {
    _backgroundFetch = fetchItems(10)
  }
  if (_buffer.length === 0) {
    return fetchItems(10)
  }
  const items = _buffer.splice(0, 10)
  for (const item of items) {
    for (const part of oddParts(item.sentence)) {
      _present.delete(part)
    }
  }
  return items
}

// Returns response status (success or not).
export async function submitReview (word: string, correct: boolean): Promise<boolean> {
  const url = new URL(currentCourse(), src)
  const options = {
    body: JSON.stringify({
      reviews: [
        { word, correct }
      ]
    }),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    method: 'POST',
    mode: 'cors'
  }
  return await fetchJson(url, options).success
}
