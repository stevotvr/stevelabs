/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2021, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict';

/**
 * Handler for the users backend.
 */
export default class UsersBackend {
  get(resolve) {
    this.db.all('SELECT id, displayName, chats, trivia, raffle, ignoreStats, autoGreet FROM users ORDER BY displayName ASC', (err, rows) => {
      resolve({ users: rows });
    });
  }

  post(resolve, req) {
    const filter = (input) => {
      const params = [];
      params.push(input.chats ? Math.max(0, input.chats) : 0);
      params.push(input.trivia ? Math.max(0, input.trivia) : 0);
      params.push(input.raffle ? Math.max(0, input.raffle) : 0);
      params.push(!!input.ignoreStats);
      params.push(!!input.autoGreet);

      return params;
    };

    let count = 0;
    if (Array.isArray(req.body.update)) {
      count += req.body.update.length;
    }

    if (!count) {
      resolve();
    }

    if (Array.isArray(req.body.update)) {
      const stmt = this.db.prepare('UPDATE users SET chats = ?, trivia = ?, raffle = ?, ignoreStats = ?, autoGreet = ? WHERE id = ?');

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
  }
}
