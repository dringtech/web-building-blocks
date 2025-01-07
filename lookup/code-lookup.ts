/**
 * Simple lookup class
 * 
 * Initialised with objects
 */
export class CodeLookup {
    #lookup: { [c: string]: string[] };

    /**
     * Creates instance of CodeLookup
     */
    constructor() {
        this.#lookup = {};
    }

    /**
     * Load new data into the lookup
     */
    async load(urls: string[]) {
        for (const url of urls) {
            const req = await fetch(url);
            const data = await req.json();
            this.#lookup = {
                ...this.#lookup,
                ...data
            }
        }
    }

    /**
     * Get value from lookup
     * 
     * @param code code to lookup
     * @returns The value stored
     */
    get(code: string) {
        return this.#lookup[code];
    }
}