/**
 * This file is part of StoveLabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

class Backend {
  constructor(app) {
    this.app = app;
    this.db = app.db.db;

    this.createGetHandlers();
    this.createPostHandlers();

    app.http.express.get('/admin', (req, res) => {
      if (req.cookies.token === undefined || req.cookies.token !== app.settings.web_token) {
        res.redirect('/login');
        return;
      }

      res.render('admin', { layout: 'admin' });
    });

    app.http.express.get('/admin/:page', (req, res) => {
      if (req.cookies.token === undefined || req.cookies.token !== app.settings.web_token) {
        res.redirect('/login');
        return;
      }

      if (!this.getHandlers[req.params.page]) {
        res.sendStatus(404);
        return;
      }

      new Promise((resolve) => {
        this.getHandlers[req.params.page](resolve, req, res);
      })
      .then(data => {
        const options = {
          layout: 'admin',
          data: data
        };

        res.render(req.params.page, options);
      });
    });

    app.http.express.post('/admin/:page', (req, res) => {
      if (req.cookies.token === undefined || req.cookies.token !== app.settings.web_token) {
        res.redirect('/login');
        return;
      }

      if (!this.postHandlers[req.params.page]) {
        res.sendStatus(404);
        return;
      }

      new Promise((resolve) => {
        this.postHandlers[req.params.page](resolve, req, res);
      })
      .then(() => {
        res.redirect(req.params.page);
      });
    });
  }

  createGetHandlers() {
    this.getHandlers = {
      settings: (resolve) => {
        resolve(this.app.settings);
      },
      alerts: (resolve) => {
        this.db.all('SELECT key, message, graphic, sound, duration FROM alerts ORDER BY key ASC', (err, rows) => {
          resolve({ alerts: rows });
        });
      },
      commands: (resolve) => {
        this.db.all('SELECT id, key, level, user_timeout, global_timeout, aliases, command FROM commands ORDER BY key ASC', (err, rows) => {
          resolve({ commands: rows });
        });
      },
      timers: (resolve) => {
        this.db.all('SELECT message FROM timers ORDER BY pos', (err, rows) => {
          resolve({
            timer_timeout: this.app.settings.timer_timeout,
            timer_chat_lines: this.app.settings.timer_chat_lines,
            messages: rows.map(v => v.message).join('\n')
          });
        });
      },
      sfx: (resolve) => {
        this.db.all('SELECT id, key, file FROM sfx ORDER BY key ASC', (err, rows) => {
          resolve({ sfx: rows });
        });
      },
      schedule: (resolve) => {
        this.db.all('SELECT id, day, hour, minute, length, game FROM schedule ORDER BY day, hour, minute, length', (err, rows) => {
          resolve({ schedule: rows });
        });
      },
      tips: (resolve) => {
        this.db.all('SELECT id, date, user, message FROM tips ORDER BY id ASC', (err, rows) => {
          resolve({ tips: rows });
        });
      },
      raffle: (resolve) => {
        this.db.all('SELECT user FROM raffle ORDER BY user ASC', (err, rows) => {
          resolve({
            raffle_active: this.app.settings.raffle_active,
            users: rows.map(v => v.user)
          });
        });
      }
    };
  }

  createPostHandlers() {
    this.postHandlers = {
      settings: (resolve, req) => {
        for (const key in req.body) {
          if (this.app.settings.hasOwnProperty(key)) {
            this.app.settings[key] = req.body[key];
          }
        }

        this.app.saveConfig();

        resolve();
      },
      alerts: (resolve, req) => {
        if (typeof req.body.update === "object") {
          const stmt = this.db.prepare('UPDATE alerts SET message = ?, graphic = ?, sound = ?, duration = ? WHERE key = ?');

          for (const key in req.body.update) {
            if (req.body.update.hasOwnProperty(key)) {
              const row = req.body.update[key];
              stmt.run(row.message, row.graphic, row.sound, Math.max(1, row.duration), key);
            }
          }

          stmt.finalize();
        }

        this.app.db.loadAlerts();

        resolve();
      },
      commands: (resolve, req) => {
        const filter = input => {
          const params = [];
          params.push(input.key.replace(/[^a-z\d]/ig, '').toLowerCase());
          params.push(Math.max(0, input.level));
          params.push(Math.max(0, input.user_timeout));
          params.push(Math.max(0, input.global_timeout));
          params.push(input.aliases.replace(/[^a-z\d,]/ig, '').toLowerCase());
          params.push(input.command);

          return params;
        };

        if (typeof req.body.delete === "object") {
          const stmt = this.db.prepare('DELETE FROM commands WHERE id = ?');

          for (const key in req.body.delete) {
            if (req.body.delete.hasOwnProperty(key)) {
              stmt.run(+key.substr(1));
            }
          }

          stmt.finalize();
        }

        if (Array.isArray(req.body.update)) {
          const stmt = this.db.prepare('UPDATE OR IGNORE commands SET key = ?, level = ?, user_timeout = ?, global_timeout = ?, aliases = ?, command = ? WHERE id = ?');

          req.body.update.forEach(row => {
            const params = filter(row);
            params.push(+row.id);

            stmt.run(params);
          });

          stmt.finalize();
        }

        if (req.body.add) {
          this.db.run('INSERT OR IGNORE INTO commands (key, level, user_timeout, global_timeout, aliases, command) VALUES (?, ?, ?, ?, ?, ?)', filter(req.body));
        }

        this.app.db.loadCommands();

        resolve();
      },
      timers: (resolve, req) => {
        this.app.settings.timer_timeout = req.body.timer_timeout;
        this.app.settings.timer_chat_lines = req.body.timer_chat_lines;
        this.app.saveConfig();

        this.db.run('DELETE FROM timers', err => {
          if (err) {
            console.warn('error saving timers');
            console.log(err);

            resolve();

            return;
          }

          const stmt = this.db.prepare('INSERT INTO timers (pos, message) VALUES (?, ?)');

          const messages = req.body.messages.split('\n');
          for (let i = 0; i < messages.length; i++) {
            stmt.run(i, messages[i]);
          }

          stmt.finalize();

          this.app.db.loadTimers();

          resolve();
        });
      },
      sfx: (resolve, req) => {
        const filter = input => {
          const params = [];
          params.push(input.key.replace(/[^a-z\d]/ig, '').toLowerCase());
          params.push(input.file);

          return params;
        };

        if (typeof req.body.delete === "object") {
          const stmt = this.db.prepare('DELETE FROM sfx WHERE id = ?');

          for (const key in req.body.delete) {
            if (req.body.delete.hasOwnProperty(key)) {
              stmt.run(+key.substr(1));
            }
          }

          stmt.finalize();
        }

        if (Array.isArray(req.body.update)) {
          const stmt = this.db.prepare('UPDATE OR IGNORE sfx SET key = ?, file = ? WHERE id = ?');

          req.body.update.forEach(row => {
            const params = filter(row);
            params.push(+row.id);

            stmt.run(params);
          });

          stmt.finalize();
        }

        if (req.body.add) {
          this.db.run('INSERT OR IGNORE INTO sfx (key, file) VALUES (?, ?)', filter(req.body));
        }

        this.app.db.loadSfx();

        resolve();
      },
      schedule: (resolve, req) => {
        const filter = input => {
          const params = [];
          params.push(Math.max(0, Math.min(6, input.day)));
          params.push(Math.max(0, Math.min(23, input.hour)));
          params.push(Math.max(0, Math.min(59, input.minute)));
          params.push(Math.max(1, input.length));
          params.push(input.game);

          return params;
        };

        if (typeof req.body.delete === "object") {
          const stmt = this.db.prepare('DELETE FROM schedule WHERE id = ?');

          for (const key in req.body.delete) {
            if (req.body.delete.hasOwnProperty(key)) {
              stmt.run(+key.substr(1));
            }
          }

          stmt.finalize();
        }

        if (Array.isArray(req.body.update)) {
          const stmt = this.db.prepare('UPDATE schedule SET day = ?, hour = ?, minute = ?, length = ?, game = ? WHERE id = ?');

          req.body.update.forEach(row => {
            const params = filter(row);
            params.push(+row.id);

            stmt.run(params);
          });

          stmt.finalize();
        }

        if (req.body.add) {
          this.db.run('INSERT INTO schedule (day, hour, minute, length, game) VALUES (?, ?, ?, ?, ?)', filter(req.body));
        }

        this.app.db.loadSchedule();

        resolve();
      },
      tips: (resolve, req) => {
        const filter = input => {
          const params = [];
          params.push(input.user.replace(/[^a-z\d_]/ig, '').toLowerCase());
          params.push(input.message);

          return params;
        };

        if (typeof req.body.delete === "object") {
          const stmt = this.db.prepare('DELETE FROM tips WHERE id = ?');

          for (const key in req.body.delete) {
            if (req.body.delete.hasOwnProperty(key)) {
              stmt.run(+key.substr(1));
            }
          }

          stmt.finalize();
        }

        if (Array.isArray(req.body.update)) {
          const stmt = this.db.prepare('UPDATE tips SET user = ?, message = ? WHERE id = ?');

          req.body.update.forEach(row => {
            const params = filter(row);
            params.push(+row.id);

            stmt.run(params);
          });

          stmt.finalize();
        }

        if (req.body.add) {
          const params = filter(req.body);
          params.push(Date.now());

          this.db.run('INSERT INTO tips (user, message, date) VALUES (?, ?, ?)', params);
        }

        resolve();
      },
      raffle: (resolve, req) => {
        if (req.body.save) {
          this.app.settings.raffle_active = !!req.body.raffle_active;
          this.app.saveConfig();
        }

        if (typeof req.body.delete === "object") {
          const stmt = this.db.prepare('DELETE FROM raffle WHERE user = ?');

          for (const key in req.body.delete) {
            if (req.body.delete.hasOwnProperty(key)) {
              stmt.run(key);
            }
          }

          stmt.finalize();
        }

        if (req.body.add) {
          const params = [];
          params.push(req.body.user.replace(/[^a-z\d_]/ig, '').toLowerCase());

          this.db.run('INSERT OR IGNORE INTO raffle (user) VALUES (?)', params);
        }

        resolve();
      }
    }
  }
}

module.exports.Backend = Backend;
