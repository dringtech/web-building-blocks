/**
 * Wrapper class to manage session storage state.
 */
export class StorageItem {
  /**
   * The name of the key 
   */
  #key: string;

  /**
   * Creates an new StorageItem instance using the specified key
   * 
   * @param key Key under which the value is stored
   */
  constructor(key: string) {
    if (!key) throw new SyntaxError('No key provided to StorageItem');
    this.#key = key;
  }

  /**
   * Set the value of the key in storage
   * @param data 
   */
  set(data: unknown) {
    globalThis.sessionStorage.setItem(this.#key, JSON.stringify(data));
  }

  /**
   * Get the value from storage
   * 
   * @returns The value set
   */
  get() {
    const data = globalThis.sessionStorage.getItem(this.#key);
    if (!data) throw new ReferenceError('Raw data not set');
    return JSON.parse(data);
  }

  /**
   * Remove the item from storage
   */
  clear() {
    globalThis.sessionStorage.removeItem(this.#key);
  }
}
