/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

/**
 * Handler for the autogreet backend.
 */
export default class AutogreetBackend {
  get(resolve) {
    this.db.all('SELECT user FROM autogreet ORDER BY user ASC', (err, rows) => {
      resolve({
        users: rows.map((v) => v.user)
      });
    });
  }

  post(resolve, req) {
    let count = 0;
    if (typeof req.body.delete === "object") {
      count += Object.keys(req.body.delete).length;
    }

    if (req.body.add) {
      count++;
    }

    if (!count) {
      resolve();
    }

    if (typeof req.body.delete === "object") {
      const stmt = this.db.prepare('DELETE FROM autogreet WHERE user = ?');

      for (const key in req.body.delete) {
        stmt.run(key, () => {
          if (!--count) {
            resolve();
          }
        });
      }

      stmt.finalize();
    }

    if (req.body.add) {
      const params = [];
      params.push(req.body.user.replace(/[^a-z\d_]/ig, '').toLowerCase());

      this.db.run('INSERT OR IGNORE INTO autogreet (user) VALUES (?)', params, () => {
        if (!--count) {
          resolve();
        }
      });
    }
  }
}
