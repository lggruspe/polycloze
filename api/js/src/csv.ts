// papaparse wrapper
import { parse } from "papaparse";

// Promise-based wrapper around papaparse.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export function parseCSV(url, callback: (data: string[]) => void): Promise<void> {
    return new Promise(resolve => {
        parse(url, {
            worker: true,
            step: row => {
                const data = row.data as string[];
                if (data.length > 0) {
                    callback(data);
                }
            },
            complete: () => resolve(),
        });
    });
}
