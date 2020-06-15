/**
 * This file is part of StoveLabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

const sqlite3 = require('sqlite3');
const crypto = require('crypto');

/**
 * Handles database operations.
 */
class Database {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    // Create the database connection
    const db = new sqlite3.Database('./data/stovelabs.db', err => {
      if (err) {
        console.warn('database connection failed');
        console.log(err);

        return;
      }

      db.serialize(() => {
        db.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)')
          .all('SELECT key, value FROM settings', (err, rows) => {
            if (err) {
              console.warn('error loading settings from the database');
              console.log(err);

              return;
            }

            rows.forEach(row => {
              app.settings[row.key] = isNaN(row.value) ? row.value : +row.value;
            });

            if (!app.settings.secret) {
              app.settings.secret = crypto.randomBytes(64).toString('hex');
            }

            app.http.setupHttpRoutes();
            app.chatbot.setupTwitchClients();

            app.api.checkUser()
            .then(valid => {
              if (valid) {
                app.api.setWebhooks();
                app.api.checkStream();
              } else {
                console.log('invalid oauth2 tokens');
              }
            });

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS alerts (key TEXT PRIMARY KEY, message TEXT, graphic TEXT, sound TEXT, duration INTEGER NOT NULL DEFAULT 5)')
                .prepare('INSERT OR IGNORE INTO alerts (key, message) VALUES (?, ?)')
                .run('cheer', '${user} cheered ${amount} bits!')
                .run('follower', '${user} is now following!')
                .run('subscription', '${user} has subscribed!')
                .run('resub', '${user} has resubscribed for ${months} months!')
                .run('subgift', '${user} gifted a subscription to ${recipient}!')
                .run('submysterygift', '${user} gifted subscriptions to ${subcount} lucky viewers!')
                .run('raid', '${user} raided the channel with ${viewers} viewers!')
                .run('host', '${user} hosted the channel with ${viewers} viewers!')
                .run('charitydonation', '${user} donated ${amount} to charity!')
                .finalize()
                .all('SELECT key, message, graphic, sound, duration FROM alerts', (err, rows) => {
                  if (err) {
                    console.warn('error loading alerts from the database');
                    console.log(err);

                    return;
                  }

                  rows.forEach(row => {
                    app.alerts[row.key] = {
                      message: row.message,
                      graphic: row.graphic,
                      sound: row.sound,
                      duration: row.duration
                    };
                  });

                  for (const key in app.alerts) {
                    const alert = app.alerts[key];
                    if (alert.graphic) {
                      const ext = alert.graphic.substring(alert.graphic.lastIndexOf('.') + 1).toLowerCase();
                      switch (ext) {
                        case 'mp4':
                        case 'mov':
                        case 'webm':
                          alert.video = alert.graphic;
                          break;
                        default:
                          alert.image = alert.graphic;
                      }
                    }

                    alert.message = alert.message.replace(/\$\{([a-z]+)\}/gi, '<span class="$1"></span>');
                  }
                });
            });

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS commands (key TEXT PRIMARY KEY, level INTEGER NOT NULL DEFAULT 0, user_timeout INTEGER NOT NULL DEFAULT 0, global_timeout INTEGER NOT NULL DEFAULT 0, aliases TEXT NOT NULL DEFAULT \'\', command TEXT NOT NULL)')
                .all('SELECT key, level, user_timeout, global_timeout, aliases, command FROM commands', (err, rows) => {
                  if (err) {
                    console.warn('error loading commands from the database');
                    console.log(err);

                    return;
                  }

                  rows.forEach(row => {
                    app.commands[row.key] = {
                      level: row.level,
                      user_timeout: row.user_timeout,
                      global_timeout: row.global_timeout,
                      aliases: row.aliases ? row.aliases.split(',') : [],
                      command: row.command
                    };
                  });

                  for (const k in app.commands) {
                    for (const k2 in app.commands[k].aliases) {
                      app.commands[app.commands[k].aliases[k2]] = app.commands[k];
                    }

                    app.commands[k].timeouts = {
                      global: 0,
                      user: {}
                    };
                  }
                });
            });

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS timers (id INTEGER PRIMARY KEY AUTOINCREMENT, pos INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL)')
                .all('SELECT message FROM timers ORDER BY pos', (err, rows) => {
                  if (err) {
                    console.warn('error loading timers from the database');
                    console.log(err);

                    return;
                  }

                  rows.forEach(row => app.timers.push(row.message));
                });
            });

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS schedule (id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER NOT NULL DEFAULT 0, hour INTEGER NOT NULL DEFAULT 0, minute INTEGER NOT NULL DEFAULT 0, length INTEGER NOT NULL DEFAULT 0, game TEXT NOT NULL DEFAULT \'\')')
                .all('SELECT day, hour, minute, length, game FROM schedule ORDER BY day, hour, minute, length', (err, rows) => {
                  if (err) {
                    console.warn('error loading schedule from the database');
                    console.log(err);

                    return;
                  }

                  rows.forEach(row => app.schedule.push(row));
                });
            });

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS sfx (key TEXT PRIMARY KEY, file TEXT NOT NULL)')
                .all('SELECT key, file FROM sfx', (err, rows) => {
                  if (err) {
                    console.warn('error loading sfx from the database');
                    console.log(err);

                    return;
                  }

                  rows.forEach(row => {
                    app.sfx[row.key] = {
                      file: row.file
                    };
                  });
                });
            });

            db.run('CREATE TABLE IF NOT EXISTS tips (id INTEGER PRIMARY KEY AUTOINCREMENT, date INTEGER NOT NULL, user TEXT NOT NULL DEFAULT \'\', message TEXT NOT NULL)');
            db.run('CREATE TABLE IF NOT EXISTS raffle (user TEXT PRIMARY KEY, tickets INTEGER NOT NULL DEFAULT 1)');
          });
        });
      });

    this.db = db;
  }
}

module.exports.Database = Database;
