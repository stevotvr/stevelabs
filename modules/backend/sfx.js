/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict';

import fs from 'fs';

/**
 * Handler for the sfx backend.
 */
export default class SfxBackend {
  get(resolve) {
    this.db.all('SELECT id, key, file, volume FROM sfx ORDER BY key ASC', (err, rows) => {
      resolve({
        sfx: rows,
        files: fs.readdirSync('./public/media').filter((e) => e.match(/\.(mp3|mp4|ogg|wav|webm)$/gi)),
      });
    });
  }

  post(resolve, req) {
    const filter = (input) => {
      const params = [];
      params.push(input.key.replace(/[^a-z\d]/ig, '').toLowerCase());
      params.push(input.file);
      params.push(input.volume ? Math.min(100, Math.max(0, input.volume)) : 100);

      return params;
    };

    let count = 0;
    if (typeof req.body.delete === "object") {
      count += Object.keys(req.body.delete).length;
    }

    if (Array.isArray(req.body.update)) {
      count += req.body.update.length;
    }

    if (req.body.add) {
      count++;
    }

    if (!count) {
      resolve();
    }

    if (typeof req.body.delete === "object") {
      const stmt = this.db.prepare('DELETE FROM sfx WHERE id = ?');

      for (const key in req.body.delete) {
        stmt.run(+key.substr(1), () => {
          if (!--count) {
            this.app.http.loadSfx();
            resolve();
          }
        });
      }

      stmt.finalize();
    }

    if (Array.isArray(req.body.update)) {
      const stmt = this.db.prepare('UPDATE OR IGNORE sfx SET key = ?, file = ?, volume = ? WHERE id = ?');

      req.body.update.forEach((row) => {
        const params = filter(row);
        params.push(+row.id);

        stmt.run(params, () => {
          if (!--count) {
            this.app.http.loadSfx();
            resolve();
          }
        });
      });

      stmt.finalize();
    }

    if (req.body.add) {
      this.db.run('INSERT OR IGNORE INTO sfx (key, file, volume) VALUES (?, ?, ?)', filter(req.body), () => {
        if (!--count) {
          this.app.http.loadSfx();
          resolve();
        }
      });
    }
  }
}
