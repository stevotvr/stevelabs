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
 * Handler for the triggers backend.
 */
export default class TriggersBackend {
  get(resolve) {
    this.db.all('SELECT id, key, level, user_timeout, global_timeout, aliases, command FROM triggers ORDER BY key ASC', (err, rows) => {
      resolve({ triggers: rows });
    });
  }

  post(resolve, req) {
    const filter = (input) => {
      const params = [];
      params.push(input.key.replace(/[^a-z\d ]/ig, '').toLowerCase());
      params.push(Math.max(0, input.level));
      params.push(Math.max(0, input.user_timeout));
      params.push(Math.max(0, input.global_timeout));
      params.push(input.aliases.replace(/[^a-z\d ,]/ig, '').toLowerCase());
      params.push(input.command);

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
      const stmt = this.db.prepare('DELETE FROM triggers WHERE id = ?');

      for (const key in req.body.delete) {
        stmt.run(+key.substr(1), () => {
          if (!--count) {
            this.app.chatbot.loadTriggers();
            resolve();
          }
        });
      }

      stmt.finalize();
    }

    if (Array.isArray(req.body.update)) {
      const stmt = this.db.prepare('UPDATE OR IGNORE triggers SET key = ?, level = ?, user_timeout = ?, global_timeout = ?, aliases = ?, command = ? WHERE id = ?');

      req.body.update.forEach((row) => {
        const params = filter(row);
        params.push(+row.id);

        stmt.run(params, () => {
          if (!--count) {
            this.app.chatbot.loadTriggers();
            resolve();
          }
        });
      });

      stmt.finalize();
    }

    if (req.body.add) {
      this.db.run('INSERT OR IGNORE INTO triggers (key, level, user_timeout, global_timeout, aliases, command) VALUES (?, ?, ?, ?, ?, ?)', filter(req.body), () => {
        if (!--count) {
          this.app.chatbot.loadTriggers();
          resolve();
        }
      });
    }
  }
}
