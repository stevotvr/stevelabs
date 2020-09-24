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
 * Handler for the schedule backend.
 */
export default class ScheduleBackend {
  get(resolve) {
    this.db.all('SELECT id, day, hour, minute, length, game FROM schedule ORDER BY day, hour, minute, length', (err, rows) => {
      resolve({ schedule: rows });
    });
  }

  post(resolve, req) {
    const filter = (input) => {
      const params = [];
      params.push(Math.max(0, Math.min(6, input.day)));
      params.push(Math.max(0, Math.min(23, input.hour)));
      params.push(Math.max(0, Math.min(59, input.minute)));
      params.push(Math.max(1, input.length));
      params.push(input.game);

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
      const stmt = this.db.prepare('DELETE FROM schedule WHERE id = ?');

      for (const key in req.body.delete) {
        stmt.run(+key.substr(1), () => {
          if (!--count) {
            this.app.http.loadSchedule();
            resolve();
          }
        });
      }

      stmt.finalize();
    }

    if (Array.isArray(req.body.update)) {
      const stmt = this.db.prepare('UPDATE schedule SET day = ?, hour = ?, minute = ?, length = ?, game = ? WHERE id = ?');

      req.body.update.forEach((row) => {
        const params = filter(row);
        params.push(+row.id);

        stmt.run(params, () => {
          if (!--count) {
            this.app.http.loadSchedule();
            resolve();
          }
        });
      });

      stmt.finalize();
    }

    if (req.body.add) {
      this.db.run('INSERT INTO schedule (day, hour, minute, length, game) VALUES (?, ?, ?, ?, ?)', filter(req.body), () => {
        if (!--count) {
          this.app.http.loadSchedule();
          resolve();
        }
      });
    }
  }
}
