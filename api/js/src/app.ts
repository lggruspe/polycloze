import "./app.css";
import { ItemBuffer } from "./buffer";
import { createEmptyItem, createItem } from "./item";
import { TTS } from "./tts";

export async function createApp(buffer: ItemBuffer): Promise<[HTMLDivElement, () => void]> {
    const tts = new TTS();
    await tts.init();

    const div = document.createElement("div");
    const item = await buffer.take();

    if (item == null) {
        return [createEmptyItem(), () => undefined];
    }

    const next = () => {
        createApp(buffer).then(([replacement, ready]) => {
            div.replaceWith(replacement);
            ready();
        });
    };

    const [child, resize] = createItem(tts, item, next);
    div.appendChild(child);

    const ready = () => {
        const blank = div.querySelector(".blank") as HTMLInputElement;
        blank.focus();
        resize();
    };
    return [div, ready];
}
