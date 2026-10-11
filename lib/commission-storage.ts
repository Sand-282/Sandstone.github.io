import { ApiError } from './commission-validation';

// Keep attachment storage comfortably below the 500 MB D1 Free database limit.
// Each BLOB is below D1's 2 MB row limit. Reservation and writes are atomic.
const CAPACITY = 200 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;

export function databaseFileStore(db: D1Database) {
  return {
    async put(key: string, body: ReadableStream<Uint8Array>, _options?: unknown) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      if (bytes.byteLength > 10 * 1024 * 1024) throw new ApiError(413, 'Each attachment must be smaller than 10 MB.');
      const count = Math.ceil(bytes.byteLength / CHUNK_BYTES);
      const statements = [db.prepare('INSERT INTO stored_objects(storage_key,size,chunk_count) SELECT ?,?,? WHERE (SELECT COALESCE(SUM(size),0) FROM stored_objects)+?<=?').bind(key, bytes.byteLength, count, bytes.byteLength, CAPACITY)];
      for (let index = 0; index < count; index++) {
        const chunk = bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
        statements.push(db.prepare('INSERT INTO stored_chunks(storage_key,chunk_index,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM stored_objects WHERE storage_key=?)').bind(key, index, chunk, key));
      }
      const result = await db.batch(statements);
      if (result[0].meta.changes !== 1) throw new ApiError(507, 'Attachment storage is full. Please submit without files and email your references.');
    },
    async get(key: string) {
      const object = await db.prepare('SELECT size,chunk_count FROM stored_objects WHERE storage_key=?').bind(key).first<{ size: number; chunk_count: number }>();
      if (!object) return null;
      let index = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (index >= object.chunk_count) { controller.close(); return; }
          try {
            const chunk = await db.prepare('SELECT data FROM stored_chunks WHERE storage_key=? AND chunk_index=?').bind(key, index).first<{ data: number[] | Uint8Array }>();
            if (!chunk) throw new Error('An attachment chunk is unavailable.');
            controller.enqueue(new Uint8Array(chunk.data));
            index++;
          } catch (error) { controller.error(error); }
        },
      });
      return { body };
    },
    async delete(keys: string | string[]) {
      const statements = (Array.isArray(keys) ? keys : [keys]).flatMap(key => [
        db.prepare('DELETE FROM stored_chunks WHERE storage_key=?').bind(key),
        db.prepare('DELETE FROM stored_objects WHERE storage_key=?').bind(key),
      ]);
      if (statements.length) await db.batch(statements);
    },
  };
}
