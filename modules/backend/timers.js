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
 * Handler for the timers backend.
 */
export default class TimersBackend {
  get(resolve) {
    this.db.all('SELECT id, command, pos FROM timers ORDER BY pos', (err, rows) => {
      resolve({
        timer_timeout: this.app.settings.timer_timeout,
        timer_chat_lines: this.app.settings.timer_chat_lines,
        commands: rows,
        pos: rows.length ? rows[rows.length - 1].pos + 1 : 0
      });
    });
  }

  post(resolve, req) {
    if (req.body.settings) {
      this.app.settings.timer_timeout = Math.max(30, req.body.timer_timeout);
      this.app.settings.timer_chat_lines = req.body.timer_chat_lines;
      this.app.saveSettings();

      resolve();
    }

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
      const stmt = this.db.prepare('DELETE FROM timers WHERE id = ?');

      for (const key in req.body.delete) {
        stmt.run(+key.substr(1), () => {
          if (!--count) {
            this.app.chatbot.loadTimers();
            resolve();
          }
        });
      }

      stmt.finalize();
    }

    if (Array.isArray(req.body.update)) {
      const stmt = this.db.prepare('UPDATE timers SET command = ? WHERE id = ?');

      req.body.update.forEach((row) => {
        stmt.run([ row.command, +row.id ], () => {
          if (!--count) {
            this.app.chatbot.loadTimers();
            resolve();
          }
        });
      });

      stmt.finalize();
    }

    if (req.body.add) {
      this.db.run('INSERT INTO timers (command, pos) VALUES (?, ?)', [ req.body.command, +req.body.pos ], () => {
        if (!--count) {
          this.app.chatbot.loadTimers();
          resolve();
        }
      });
    }
  }
}
