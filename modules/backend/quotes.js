/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict';

/**
 * Handler for the quotes backend.
 */
export default class QuotesBackend {
  get(resolve) {
    this.db.all('SELECT id, date, user, game, message FROM quotes ORDER BY id ASC', (err, rows) => {
      resolve({ quotes: rows });
    });
  }

  post(resolve, req) {
    const filter = (input) => {
      const params = [];
      params.push(input.user.replace(/[^a-z\d_]/ig, '').toLowerCase());
      params.push(input.game)
      params.push(input.message);

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
      const stmt = this.db.prepare('DELETE FROM quotes WHERE id = ?');

      for (const key in req.body.delete) {
        stmt.run(+key.substr(1), () => {
          if (!--count) {
            resolve();
          }
        });
      }

      stmt.finalize();
    }

    if (Array.isArray(req.body.update)) {
      const stmt = this.db.prepare('UPDATE quotes SET user = ?, game = ?, message = ? WHERE id = ?');

      req.body.update.forEach((row) => {
        const params = filter(row);
        params.push(+row.id);

        stmt.run(params, () => {
          if (!--count) {
            resolve();
          }
        });
      });

      stmt.finalize();
    }

    if (req.body.add) {
      const params = filter(req.body);
      params.push(Date.now());

      this.db.run('INSERT INTO quotes (user, game, message, date) VALUES (?, ?, ?, ?)', params, () => {
        if (!--count) {
          resolve();
        }
      });
    }
  }
}
