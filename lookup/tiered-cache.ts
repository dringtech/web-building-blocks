type TieredLookupResult<R = string[]> = {
  [code: string]: R | TieredLookupResult;
};

type TieredDataLoader = (key: string) => Promise<TieredLookupResult>;
type TieredKeySplitter = (key: string) => string[];

type TieredCacheConfig = {
  loader: TieredDataLoader;
  splitter?: TieredKeySplitter;
};

export class TieredCache<T> {
  #data: TieredLookupResult<T>;
  #splitter: (key: string) => string[];
  #loadFunction: TieredDataLoader;

  /**
   * Tiered cache, accessed via nested keys
   *
   * As an example `a.b.c` would descend the data loaded and return the value
   *
   * Data is loaded as required, using the load function which is provided. This must take the requested key, and return the data to be loaded.
   *
   * A splitter function takes the compound key and returns the appropriate list of levels.
   *
   * There is limited checking of correctness, so it's up to you to provide the correct structure!
   *
   * @param config Configuration of the instance
   */
  constructor(config: TieredCacheConfig) {
    const { splitter, loader } = {
      splitter: (k: string) => k.trim().split(/\s+/),
      ...config,
    };
    if (!loader) throw new SyntaxError("No loader function provided");

    this.#data = {};
    this.#splitter = splitter;
    this.#loadFunction = loader;
  }

  /**
   * Loader which calls the data load function and adds the result into the cache
   *
   * @param key Key that caused the cache miss
   */
  async #loader(key: string): Promise<void> {
    const data = await this.#loadFunction(key);
    this.#data = { ...this.#data, ...data };
  }

  /**
   * Getter for the cache levels. Descends the data tree and returns the result of the path.
   *
   * @param levels Levels of the tree
   * @returns Cached value specified by the levels
   */
  #get(levels: string[]): T {
    return levels.reduce((a, k) => a[k], this.#data);
  }

  /**
   * Gets the value from the cache. If there is a cache miss, attempts to load the data.
   * If that fails, raises a TypeError!
   *
   * @param key Key to lookup
   * @returns Value from cache
   */
  async lookupOne(key: string): Promise<T> {
    const levels = this.#splitter(key);

    try {
      return this.#get(levels);
    } catch (e) {
      if (e instanceof TypeError) {
        console.warn("Cache miss. Fetching data.");
        await this.#loader(key);
        return this.#get(levels);
      } else {
        throw e;
      }
    }
  }
}
