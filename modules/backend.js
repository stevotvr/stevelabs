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
 * Provides the backend interface.
 */
class Backend {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
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

  /**
   * Create the functions for handling GET requests.
   */
  createGetHandlers() {
    this.getHandlers = {
      settings: (resolve) => {
        resolve(this.app.settings);
      },
      alerts: (resolve) => {
        this.db.all('SELECT key, message, graphic, sound, duration, videoVolume, soundVolume FROM alerts ORDER BY key ASC', (err, rows) => {
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
        this.db.all('SELECT id, key, file, volume FROM sfx ORDER BY key ASC', (err, rows) => {
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
      quotes: (resolve) => {
        this.db.all('SELECT id, date, user, game, message FROM quotes ORDER BY id ASC', (err, rows) => {
          resolve({ quotes: rows });
        });
      },
      raffle: (resolve) => {
        this.db.all('SELECT user FROM raffle ORDER BY user ASC', (err, rows) => {
          resolve({
            raffle_active: this.app.settings.raffle_active,
            users: rows.map(v => v.user)
          });
        });
      },
      autoshoutout: (resolve) => {
        this.db.all('SELECT user FROM autoshoutout ORDER BY user ASC', (err, rows) => {
          resolve({
            users: rows.map(v => v.user)
          });
        });
      }
    };
  }

  /**
   * Create the functions for handling POST requests.
   */
  createPostHandlers() {
    this.postHandlers = {
      settings: (resolve, req) => {
        const settings = this.app.settings;

        if (req.body.discord_bot_token !== settings.discord_bot_token) {
          settings.discord_bot_token = req.body.discord_bot_token;

          this.app.discord.login(settings.discord_bot_token);
        }

        settings.discord_channel = req.body.discord_channel;
        settings.discord_live_message = req.body.discord_live_message;
        settings.discord_ended_message = req.body.discord_ended_message;

        settings.twitter_consumer_key = req.body.twitter_consumer_key;
        settings.twitter_consumer_secret = req.body.twitter_consumer_secret;
        settings.twitter_access_token_key = req.body.twitter_access_token_key;
        settings.twitter_access_token_secret = req.body.twitter_access_token_secret;
        this.app.twitter.login();

        settings.donordrive_instance = req.body.donordrive_instance;
        settings.donordrive_participant = req.body.donordrive_participant;

        settings.countdown_audio = req.body.countdown_audio;
        settings.countdown_audio_volume = Math.max(0, Math.min(100, req.body.countdown_audio_volume));

        this.app.saveSettings();

        resolve();
      },
      alerts: (resolve, req) => {
        if (typeof req.body.update === "object") {
          let count = Object.keys(req.body.update).length;
          if (!count) {
            resolve();
          }

          const stmt = this.db.prepare('UPDATE alerts SET message = ?, graphic = ?, sound = ?, duration = ?, videoVolume = ?, soundVolume = ? WHERE key = ?');

          for (const key in req.body.update) {
            const row = req.body.update[key];
            const videoVolume = row.videoVolume ? Math.min(100, Math.max(0, row.videoVolume)) : 100;
            const soundVolume = row.soundVolume ? Math.min(100, Math.max(0, row.soundVolume)) : 100;
            stmt.run(row.message, row.graphic, row.sound, Math.max(1, row.duration), videoVolume, soundVolume, key, () => {
              if (!--count) {
                this.app.db.loadAlerts();
                resolve();
              }
            });
          }

          stmt.finalize();
        }
      },
      commands: (resolve, req) => {
        const filter = input => {
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
          const stmt = this.db.prepare('DELETE FROM commands WHERE id = ?');

          for (const key in req.body.delete) {
            stmt.run(+key.substr(1), () => {
              if (!--count) {
                this.app.db.loadCommands();
                resolve();
              }
            });
          }

          stmt.finalize();
        }

        if (Array.isArray(req.body.update)) {
          const stmt = this.db.prepare('UPDATE OR IGNORE commands SET key = ?, level = ?, user_timeout = ?, global_timeout = ?, aliases = ?, command = ? WHERE id = ?');

          req.body.update.forEach(row => {
            const params = filter(row);
            params.push(+row.id);

            stmt.run(params, () => {
              if (!--count) {
                this.app.db.loadCommands();
                resolve();
              }
            });
          });

          stmt.finalize();
        }

        if (req.body.add) {
          this.db.run('INSERT OR IGNORE INTO commands (key, level, user_timeout, global_timeout, aliases, command) VALUES (?, ?, ?, ?, ?, ?)', filter(req.body), () => {
            if (!--count) {
              this.app.db.loadCommands();
              resolve();
            }
          });
        }
      },
      timers: (resolve, req) => {
        this.app.settings.timer_timeout = req.body.timer_timeout;
        this.app.settings.timer_chat_lines = req.body.timer_chat_lines;
        this.app.saveSettings();

        this.db.run('DELETE FROM timers', err => {
          if (err) {
            console.warn('error saving timers');
            console.log(err);

            resolve();

            return;
          }

          const messages = req.body.messages.split('\n');

          let count = messages.length;
          if (!count) {
            resolve();
          }

          const stmt = this.db.prepare('INSERT INTO timers (pos, message) VALUES (?, ?)');

          for (let i = 0; i < messages.length; i++) {
            stmt.run(i, messages[i], () => {
              if (!--count) {
                this.app.db.loadTimers();
                resolve();
              }
            });
          }

          stmt.finalize();
        });
      },
      sfx: (resolve, req) => {
        const filter = input => {
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
                this.app.db.loadSfx();
                resolve();
              }
            });
          }

          stmt.finalize();
        }

        if (Array.isArray(req.body.update)) {
          const stmt = this.db.prepare('UPDATE OR IGNORE sfx SET key = ?, file = ?, volume = ? WHERE id = ?');

          req.body.update.forEach(row => {
            const params = filter(row);
            params.push(+row.id);

            stmt.run(params, () => {
              if (!--count) {
                this.app.db.loadSfx();
                resolve();
              }
            });
          });

          stmt.finalize();
        }

        if (req.body.add) {
          this.db.run('INSERT OR IGNORE INTO sfx (key, file, volume) VALUES (?, ?, ?)', filter(req.body), () => {
            if (!--count) {
              this.app.db.loadSfx();
              resolve();
            }
          });
        }
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
                this.app.db.loadSchedule();
                resolve();
              }
            });
          }

          stmt.finalize();
        }

        if (Array.isArray(req.body.update)) {
          const stmt = this.db.prepare('UPDATE schedule SET day = ?, hour = ?, minute = ?, length = ?, game = ? WHERE id = ?');

          req.body.update.forEach(row => {
            const params = filter(row);
            params.push(+row.id);

            stmt.run(params, () => {
              if (!--count) {
                this.app.db.loadSchedule();
                resolve();
              }
            });
          });

          stmt.finalize();
        }

        if (req.body.add) {
          this.db.run('INSERT INTO schedule (day, hour, minute, length, game) VALUES (?, ?, ?, ?, ?)', filter(req.body), () => {
            if (!--count) {
              this.app.db.loadSchedule();
              resolve();
            }
          });
        }
      },
      tips: (resolve, req) => {
        const filter = input => {
          const params = [];
          params.push(input.user.replace(/[^a-z\d_]/ig, '').toLowerCase());
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
          const stmt = this.db.prepare('DELETE FROM tips WHERE id = ?');

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
          const stmt = this.db.prepare('UPDATE tips SET user = ?, message = ? WHERE id = ?');

          req.body.update.forEach(row => {
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

          this.db.run('INSERT INTO tips (user, message, date) VALUES (?, ?, ?)', params, () => {
            if (!--count) {
              resolve();
            }
          });
        }
      },
      quotes: (resolve, req) => {
        const filter = input => {
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

          req.body.update.forEach(row => {
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
      },
      raffle: (resolve, req) => {
        if (req.body.save) {
          this.app.settings.raffle_active = !!req.body.raffle_active;
          this.app.saveSettings();
        }

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
          const stmt = this.db.prepare('DELETE FROM raffle WHERE user = ?');

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

          this.db.run('INSERT OR IGNORE INTO raffle (user) VALUES (?)', params, () => {
            if (!--count) {
              resolve();
            }
          });
        }
      },
      autoshoutout: (resolve, req) => {
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
          const stmt = this.db.prepare('DELETE FROM autoshoutout WHERE user = ?');

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

          this.db.run('INSERT OR IGNORE INTO autoshoutout (user) VALUES (?)', params, () => {
            if (!--count) {
              resolve();
            }
          });
        }
      }
    }
  }
}

module.exports.Backend = Backend;
