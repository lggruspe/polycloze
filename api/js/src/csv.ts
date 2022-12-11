// Peekable stream of characters.
class CharStream {
    reader: ReadableStreamDefaultReader;
    chunk: string;
    position: number;

    constructor(reader: ReadableStreamDefaultReader) {
        this.reader = reader;
        this.chunk = "";
        this.position = 0;
    }

    // Reads next chunk from the text stream.
    // Returns true if a chunk was read, false otherwise.
    private async readChunk(): Promise<boolean> {
        const decoder = new TextDecoder("utf-8");
        const options = {stream: true};

        const {value} = await this.reader.read();
        if (!value) {
            return false;
        }
        this.chunk = decoder.decode(value, options);
        this.position = 0;
        return true;
    }

    // Peeks at the next character.
    // Returns undefined if there's none.
    async peek(): Promise<string | undefined> {
        if (this.position < this.chunk.length) {
            return this.chunk.slice(this.position, this.position+1);
        }
        if (!await this.readChunk()) {
            return undefined;
        }
        return this.chunk.slice(0, 1);
    }

    // Advances character stream.
    // Returns the next character in the stream, or undefined if there's none.
    async advance(): Promise<string | undefined> {
        if (this.position < this.chunk.length) {
            const result = this.chunk.slice(this.position, this.position+1);
            this.position++;
            return result;
        }
        if (!await this.readChunk()) {
            return undefined;
        }
        const result = this.chunk.slice(0, 1);
        this.position++;
        return result;
    }
}

type Field = {
    tag: "field";
    value: string;
};

type FieldDelim = {
    tag: "field-delim";
}

type RecordDelim = {
    tag: "record-delim";
}

type Token = Field | FieldDelim | RecordDelim;

// Tokenizes CSV stream.
async function * tokenize(stream: CharStream): AsyncGenerator<Token> {
    for (;;) {
        const c = await stream.peek();
        if (!c) {
            break;
        }

        switch (c) {
        case ",":
            await stream.advance();
            yield {tag: "field-delim"};
            break;
        case "\n":
            await stream.advance();
            yield {tag: "record-delim"};
            break;
        case "\"":
            yield await readQuoted(stream);
            break;
        default:
            yield await readField(stream);
            break;
        }
    }
}

// Reads quoted field value.
// Assumes the next character in the stream is `"`.
async function readQuoted(stream: CharStream): Promise<Field> {
    // Pop opening quotes.
    await stream.advance();

    let value = "";
    for (;;) {
        const c = await stream.peek();
        if (!c) {
            // Treat opening '"' as a literal if it's not closed.
            return {tag: "field", value: "\"" + value};
        }

        if (c !== "\"") {
            value += c;
            await stream.advance();
            continue;
        }

        await stream.advance();
        if (await stream.peek() !== "\"") {
            return {tag: "field", value};
        }
        value += "\"";
        await stream.advance();
    }
}

// Reads unquoted field value.
// Assumes the first character in the stream is not `"`.
async function readField(stream: CharStream): Promise<Field> {
    // Read until comma, newline or EOF.
    let value = "";

    for (;;) {
        const c = await stream.peek();
        if (!c) {
            return {tag: "field", value};
        }

        switch (c) {
        case "\n":
        case ",":
            return {tag: "field", value};
        default:
            value += c;
            await stream.advance();
        }
    }
}

// Parses CSV stream by line.
async function * parse(stream: CharStream): AsyncGenerator<string[]> {
    let record = [];
    for await (const token of tokenize(stream)) {
        switch (token.tag) {
        case "field":
            record.push((token as Field).value);
            break;
        case "field-delim":
            break;
        case "record-delim":
            yield record;
            record = [];
            break;
        }
    }
}

// Generates records in CSV stream.
export async function * streamCSV(reader: ReadableStreamDefaultReader): AsyncGenerator<string[]> {
    const stream = new CharStream(reader);
    for await (const record of parse(stream)) {
        yield record;
    }
}
