import papaparse from "papaparse";

export function parseCSV(text: string): string[] {
    return papaparse.parse(text).data as string[];
}
