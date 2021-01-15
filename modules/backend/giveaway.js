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
 * Handler for the giveaway backend.
 */
export default class GiveawayBackend {
  get(resolve, req) {
    if (req.query.group) {
      this.db.get('SELECT id, name FROM giveaway_groups WHERE id = ?', req.query.group, (err, row) => {
        if (!row) {
          res.status(404);
          resolve();

          return;
        }

        this.db.all('SELECT id, name, key, recipient FROM giveaway WHERE groupId = ? ORDER BY name ASC', row.id, (err, rows) => {
          resolve({
            group: row,
            items: rows.filter((v) => v.recipient === null),
            claimed: rows.filter((v) => v.recipient !== null)
          });
        });
      });
    } else {
      this.db.all('SELECT id, name, random, raffle FROM giveaway_groups ORDER BY name ASC', (err, rows) => {
        resolve({ groups: rows });
      });
    }
  }

  post(resolve, req) {
    if (req.body.group) {
      const filter = (input) => {
        const params = [];
        params.push(input.name);
        params.push(input.key);

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
        const stmt = this.db.prepare('DELETE FROM giveaway WHERE id = ?');

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
        const stmt = this.db.prepare('UPDATE giveaway SET name = ?, key = ? WHERE id = ?');

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
        params.unshift(+req.body.group);

        this.db.run('INSERT INTO giveaway (groupId, name, key) VALUES (?, ?, ?)', params, () => {
          if (!--count) {
            this.app.http.loadSchedule();
            resolve();
          }
        });
      }
    } else {
      const filter = (input) => {
        const params = [];
        params.push(input.name);
        params.push(!!input.random);
        params.push(!!input.raffle);

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
        const stmt1 = this.db.prepare('DELETE FROM giveaway WHERE groupId = ?');
        const stmt2 = this.db.prepare('DELETE FROM giveaway_groups WHERE id = ?');

        for (const key in req.body.delete) {
          stmt1.run(+key.substr(1));
          stmt2.run(+key.substr(1), () => {
            if (!--count) {
              resolve();
            }
          });
        }

        stmt1.finalize();
        stmt2.finalize();
      }

      if (Array.isArray(req.body.update)) {
        const stmt = this.db.prepare('UPDATE giveaway_groups SET name = ?, random = ?, raffle = ? WHERE id = ?');

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
        this.db.run('INSERT INTO giveaway_groups (name, random, raffle) VALUES (?, ?, ?)', filter(req.body), () => {
          if (!--count) {
            resolve();
          }
        });
      }
    }
  }
}
